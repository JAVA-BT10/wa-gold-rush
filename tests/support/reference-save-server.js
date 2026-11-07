/**
 * Reference model of the GGR_SaveProgress v2 server contract.
 *
 * TEST SUPPORT ONLY — this is NOT deployable and does not prove anything
 * about the Power Automate / SharePoint tenant. It encodes the protocol in
 * docs/power-automate/save-protocol-v2.md so the browser client can be
 * exercised against the intended server behaviour and so the same vectors
 * can be replayed against a real test flow during tenant acceptance.
 *
 * Model of server state:
 *   rows        – GGR_StudentProgress: one row per ProgressKey
 *                 { revision, runGeneration, runId, contentHash, lastSaveRequestId,
 *                   payload, recentRequests:[{saveRequestId,binding,response}] }
 *   receipts    – separate durable request-receipt store keyed by saveRequestId
 *                 { progressKey, binding, response }
 *   generations – authoritative run generation per ProgressKey (advanced by reset)
 *
 * Order of checks (important): validate → idempotency receipt → generation →
 * compare-and-swap on revision → atomic row + recentRequests → durable receipt.
 * The bounded row ring pins every entry whose durable receipt is still missing.
 * Receipt storage capacity blocks persistence rather than pruning old receipts.
 * This synchronous in-memory model is NOT tenant concurrency/auth/ETag evidence.
 */
const store = require('../../shared/level-save-store.js');
const NON_BINDING_FIELDS = new Set(['saveRequestId', 'clientTimestampUtc', 'clientVersion', 'contentHash']);

class ReferenceSaveServer {
    constructor(options = {}) {
        this.rows = new Map();
        this.receipts = new Map();
        this.generations = new Map();
        this.log = [];
        this.failNextReceiptWrite = false;
        this.receiptRetentionLimit = Number.isInteger(options.receiptRetentionLimit) && options.receiptRetentionLimit >= 0
            ? options.receiptRetentionLimit : Infinity;
        this.recentRequestLimit = Number.isInteger(options.recentRequestLimit) && options.recentRequestLimit >= 1
            ? options.recentRequestLimit : 10;
    }

    static binding(request) {
        const content = {};
        Object.keys(request).forEach((key) => {
            if (!NON_BINDING_FIELDS.has(key)) content[key] = request[key];
        });
        return store.canonicalJson(content);
    }

    static ack(request, revision, extra = {}) {
        return {
            ok: true,
            protocolVersion: 2,
            saveRequestId: request.saveRequestId,
            progressKey: request.progressKey,
            runGeneration: request.runGeneration,
            revision,
            ...extra
        };
    }

    currentGeneration(progressKey) {
        return this.generations.get(progressKey) || 1;
    }

    handle(request = {}) {
        this.log.push({ saveRequestId: request.saveRequestId, baseRevision: request.baseRevision });
        if (request.protocolVersion !== 2 || !request.saveRequestId || !request.progressKey
            || !Number.isInteger(request.runGeneration) || !request.runId || !request.contentHash
            || !(request.baseRevision === null || Number.isInteger(request.baseRevision))) {
            return { ok: false, protocolVersion: 2, code: 'invalid_request' };
        }

        const binding = ReferenceSaveServer.binding(request);
        // 1. Idempotency BEFORE any stale/conflict check. Never trust a browser
        // hash (or payload length) as proof that the immutable content matches.
        const receipt = this.receipts.get(request.saveRequestId);
        if (receipt) {
            if (receipt.progressKey === request.progressKey && receipt.binding === binding) {
                return { ...receipt.response, deduplicated: true };
            }
            return { ok: false, protocolVersion: 2, code: 'request_id_reused' };
        }
        // Crash recovery includes older requests after intervening writes. Scan
        // every row so an unreceipted ID cannot be rebound to a different key.
        for (const savedRow of this.rows.values()) {
            const pending = savedRow.recentRequests.find((entry) => entry.saveRequestId === request.saveRequestId);
            if (!pending) continue;
            if (pending.binding !== binding) return { ok: false, protocolVersion: 2, code: 'request_id_reused' };
            this.storeReceipt(request, pending.response);
            return { ...pending.response, deduplicated: true };
        }
        const row = this.rows.get(request.progressKey);

        // 2. Run generation (server-authoritative; advanced only by reset).
        const generation = this.currentGeneration(request.progressKey);
        if (request.runGeneration < generation) {
            return { ok: false, protocolVersion: 2, code: 'generation_stale', currentGeneration: generation };
        }
        if (request.runGeneration > generation) {
            // A client cannot start a new run by itself: an authorised reset must.
            return { ok: false, protocolVersion: 2, code: 'precondition_failed', currentGeneration: generation, currentRevision: row?.revision ?? null };
        }

        // 3. Compare-and-swap.
        if (request.baseRevision === null) {
            if (row) return { ok: false, protocolVersion: 2, code: 'row_exists', currentRevision: row.revision, currentGeneration: generation };
        } else if (!row || row.revision !== request.baseRevision || row.runId !== request.runId) {
            return {
                ok: false,
                protocolVersion: 2,
                code: row && row.runId !== request.runId ? 'precondition_failed' : 'revision_conflict',
                currentRevision: row?.revision ?? null,
                currentGeneration: generation
            };
        }

        // 4. A ring entry is evictable only after its exact original receipt is
        // durable. Otherwise hold this write; a retry of the old request repairs it.
        const recentRequests = [...(row?.recentRequests || [])];
        if (recentRequests.length >= this.recentRequestLimit) {
            const oldest = recentRequests[0];
            if (!this.hasDurableReceipt(oldest)) return { ok: false, protocolVersion: 2, code: 'receipt_repair_required' };
            recentRequests.shift();
        }
        const revision = (row?.revision || 0) + 1;
        const response = ReferenceSaveServer.ack(request, revision);
        recentRequests.push({ saveRequestId: request.saveRequestId, binding, response: store.clone(response) });
        // The row and recovery ring commit atomically in this reference model.
        this.rows.set(request.progressKey, {
            revision,
            runGeneration: request.runGeneration,
            runId: request.runId,
            contentHash: request.contentHash,
            lastSaveRequestId: request.saveRequestId,
            payload: store.clone(request),
            recentRequests
        });
        this.storeReceipt(request, response);
        return response;
    }

    hasDurableReceipt(entry) {
        const receipt = this.receipts.get(entry.saveRequestId);
        return !!receipt && receipt.binding === entry.binding
            && store.canonicalJson(receipt.response) === store.canonicalJson(entry.response);
    }

    storeReceipt(request, response) {
        if (this.failNextReceiptWrite) {
            this.failNextReceiptWrite = false;
            const error = new Error('simulated crash after row write');
            error.crashed = true;
            throw error;
        }
        if (!this.receipts.has(request.saveRequestId) && this.receipts.size >= this.receiptRetentionLimit) {
            const error = new Error('simulated durable receipt capacity exhausted');
            error.code = 'receipt_capacity';
            throw error;
        }
        this.receipts.set(request.saveRequestId, {
            progressKey: request.progressKey,
            binding: ReferenceSaveServer.binding(request),
            response: store.clone(response)
        });
    }

    /** Authorised, audited reset of ONE level: advances the generation. */
    reset(progressKey) {
        const row = this.rows.get(progressKey);
        if (row?.recentRequests.some((entry) => !this.hasDurableReceipt(entry))) {
            const error = new Error('reset held until missing durable receipts are repaired');
            error.code = 'receipt_repair_required';
            throw error;
        }
        const next = this.currentGeneration(progressKey) + 1;
        this.generations.set(progressKey, next);
        this.rows.delete(progressKey);
        return next;
    }

    /** A callFlow-compatible transport for SharePointSync tests. */
    transport(options = {}) {
        return async (_flowName, payload) => {
            if (options.dropResponse && options.dropResponse(payload)) {
                try { this.handle(payload); } catch (_) {}
                return { success: false, networkError: true, error: 'Failed to fetch' };
            }
            let body;
            try {
                body = this.handle(payload);
            } catch (error) {
                return { success: false, networkError: true, error: error.message };
            }
            return { success: true, status: 200, data: body };
        };
    }
}

module.exports = { ReferenceSaveServer };

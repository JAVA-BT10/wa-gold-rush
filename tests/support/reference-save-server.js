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
 *                 { revision, runGeneration, runId, contentHash, lastSaveRequestId, payload }
 *   receipts    – separate durable request-receipt store keyed by saveRequestId
 *                 { progressKey, contentHash, baseRevision, response }
 *   generations – authoritative run generation per ProgressKey (advanced by reset)
 *
 * Order of checks (important): validate → idempotency receipt → generation →
 * compare-and-swap on revision → write row + receipt together → respond.
 */
class ReferenceSaveServer {
    constructor(options = {}) {
        this.rows = new Map();
        this.receipts = new Map();
        this.generations = new Map();
        this.log = [];
        this.failNextReceiptWrite = false;
        this.receiptRetentionLimit = Number.isInteger(options.receiptRetentionLimit) ? options.receiptRetentionLimit : Infinity;
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

        // 1. Idempotency BEFORE any stale/conflict check.
        const receipt = this.receipts.get(request.saveRequestId);
        if (receipt) {
            if (receipt.progressKey === request.progressKey
                && receipt.contentHash === request.contentHash
                && receipt.baseRevision === request.baseRevision) {
                return { ...receipt.response, deduplicated: true };
            }
            return { ok: false, protocolVersion: 2, code: 'request_id_reused' };
        }
        // Crash-recovery fallback: the row write committed but the receipt
        // write did not. The row remembers its last request id + content.
        const row = this.rows.get(request.progressKey);
        if (row && row.lastSaveRequestId === request.saveRequestId) {
            if (row.contentHash === request.contentHash && row.runGeneration === request.runGeneration) {
                const response = ReferenceSaveServer.ack(request, row.revision);
                this.storeReceipt(request, response);
                return { ...response, deduplicated: true };
            }
            return { ok: false, protocolVersion: 2, code: 'request_id_reused' };
        }

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

        // 4. Conditional write + receipt (one transaction in a real backend).
        const revision = (row?.revision || 0) + 1;
        this.rows.set(request.progressKey, {
            revision,
            runGeneration: request.runGeneration,
            runId: request.runId,
            contentHash: request.contentHash,
            lastSaveRequestId: request.saveRequestId,
            payload: JSON.parse(JSON.stringify(request))
        });
        const response = ReferenceSaveServer.ack(request, revision);
        if (this.failNextReceiptWrite) {
            this.failNextReceiptWrite = false;
            const error = new Error('simulated crash after row write');
            error.crashed = true;
            throw error;
        }
        this.storeReceipt(request, response);
        return response;
    }

    storeReceipt(request, response) {
        this.receipts.set(request.saveRequestId, {
            progressKey: request.progressKey,
            contentHash: request.contentHash,
            baseRevision: request.baseRevision,
            response
        });
        while (this.receipts.size > this.receiptRetentionLimit) {
            this.receipts.delete(this.receipts.keys().next().value);
        }
    }

    /** Authorised, audited reset of ONE level: advances the generation. */
    reset(progressKey) {
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

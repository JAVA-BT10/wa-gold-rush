/**
 * Shared test helpers for the per-level save architecture tests.
 * Mock/vm harness only — passing tests here are not evidence of any tenant
 * (SharePoint / Power Automate) deployment.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function createStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); },
        __keys() { return [...store.keys()]; },
        __values() { return [...store.values()]; }
    };
}

function buildRosterSession(overrides = {}) {
    return {
        ok: true,
        source: 'GGR_LoginStudent',
        schemaVersion: 2,
        studentCode: 'SC-1',
        studentId: '123456',
        studentName: 'Alex Smith',
        leaderboardName: 'Gold Miner',
        classCode: '6B',
        assignedLevel: 2,
        authenticatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

function setSession(storage, overrides = {}) {
    storage.setItem(STUDENT_SESSION_KEY, JSON.stringify(buildRosterSession(overrides)));
    return storage;
}

function createSessionStorage(initial = {}, sessionOverrides = {}) {
    return setSession(createStorage(initial), sessionOverrides);
}

function createStubElement(id) {
    const classes = new Set();
    return {
        id,
        style: {},
        textContent: '',
        innerHTML: '',
        value: '',
        disabled: false,
        onclick: null,
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
            toggle: (name, force) => (force === undefined ? (classes.has(name) ? classes.delete(name) : classes.add(name)) : (force ? classes.add(name) : classes.delete(name)))
        },
        appendChild() {},
        setAttribute() {},
        addEventListener() {}
    };
}

/**
 * Loads the real Level 2–5 page scripts into a vm context and runs the same
 * per-level load used at page start (loadLevelGameForSession).
 */
function buildStudentGameHarness({ level = 2, search, storage = createStorage(), extraGlobals = {}, stubSync = true } = {}) {
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, createStubElement(id));
        return elements.get(id);
    };
    const query = search !== undefined ? search : `?level=${level}`;
    const context = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        document: {
            addEventListener() {},
            getElementById: getElement,
            createElement: () => createStubElement('dynamic'),
            querySelector() { return null; },
            querySelectorAll() { return []; },
            body: { appendChild() {} }
        },
        location: {
            href: `https://example.com/levels/level-2-tycoon/index.html${query}`,
            search: query,
            pathname: '/levels/level-2-tycoon/index.html'
        },
        addEventListener() {},
        localStorage: storage,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        AbortController,
        alert() {},
        confirm() { return true; },
        CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
        ...extraGlobals
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext([
        read('shared/student-session.js'),
        read('shared/level-capabilities.js'),
        read('shared/level-save-store.js'),
        read('shared/save-protocol.js'),
        read('shared/cloud-restore.js'),
        read('shared/progression-snapshot.js'),
        read('shared/progression-quiz.js'),
        read('shared/investment-profile.js'),
        read('levels/level-2-tycoon/game-state.js'),
        read('levels/level-2-tycoon/level-access-guard.js'),
        read('levels/level-2-tycoon/script.js'),
        'this.realSyncPlayerRecord = syncPlayerRecord;',
        stubSync ? 'syncPlayerRecord = function syncPlayerRecordStub() { this.__syncCalls = (this.__syncCalls || 0) + 1; }.bind(this);' : '',
        'updateAllUI = function () {};',
        'this.__setGameState = (value) => { gameState = value; };',
        'this.GameStateClass = GameState;',
        'this.LevelAccessGuardClass = LevelAccessGuard;',
        'this.loadLevelGameForSession = loadLevelGameForSession;',
        'this.maybeRestoreLevelFromCloud = maybeRestoreLevelFromCloud;',
        'this.getAuthenticatedStudentSession = getAuthenticatedStudentSession;',
        'this.getLevelLoadState = () => levelLoadState;',
        'this.getCloudUploadHold = () => cloudUploadHold;',
        'this.resetGame = resetGame;',
        'this.loadGame = loadGame;',
        'this.getAssignedLevelFromUrl = getAssignedLevelFromUrl;',
        'this.getNextAssignedLevel = getNextAssignedLevel;',
        'this.getProgressSaveScheduler = getProgressSaveScheduler;',
        'this.handleLevelSaveStorageChange = handleLevelSaveStorageChange;'
    ].join('\n'), context);

    const config = JSON.parse(read('shared/game-config.json'));
    const gameState = new context.GameStateClass();
    gameState.originalGameConfig = config;
    gameState.gameConfig = JSON.parse(JSON.stringify(config));
    context.__setGameState(gameState);
    let loadResult = null;
    const requested = context.getAssignedLevelFromUrl();
    if (requested !== null) {
        loadResult = context.loadLevelGameForSession(context.getAuthenticatedStudentSession(), requested);
    }
    return { context, gameState, getElement, storage, loadResult, requestedLevel: requested };
}

module.exports = {
    ROOT,
    STUDENT_SESSION_KEY,
    read,
    createStorage,
    buildRosterSession,
    setSession,
    createSessionStorage,
    buildStudentGameHarness
};

/* global Alpine */

function studio() {
  return {
    // ──────── state ────────
    tab: "generate",
    health: { ok: false },
    // Hardware snapshot from /api/system — populated once on init().
    // Used by the Models tab to render per-card fit chips comparing each
    // model's memory floor against the user's actual RAM.
    system: { chip: null, chip_tier: null, unified_memory_gb: null },
    // ──────── RAM slider (Models tab hardware planner) ────────
    // Effective unified-memory budget used to score every model's fit chip
    // LIVE on the client. Defaults to detected RAM; the user can drag/type
    // it to preview a different machine (e.g. plan a 512 GB Mac before
    // buying it). Seeded in _initRamPlanner() after /api/system.
    ramGb: null,
    ramIsDetected: true,          // false once the user overrides the slider
    ramTiers: [8, 16, 24, 32, 48, 64, 128, 256, 512],
    families: {},
    models: [],
    jobs: [],
    candidates: [],
    loras: [],
    pendingDownload: null,
    confirmDialog: null,           // in-app confirm modal (webview-safe replacement for confirm())
    downloadToken: "",
    importForm: { source_path: "", repo: "" },
    importMessage: "",
    importMessageKind: "error",   // "success" | "error" — drives styling of the inline message
    importResult: null,            // last successful result, kept on screen with target path until next submit
    _streamHandle: null,
    _genStreamHandle: null,
    _refreshHandle: null,
    _tickHandle: null,
    _lastRandomPromptIndex: -1,
    _nowSec: Math.floor(Date.now() / 1000),   // reactive "now" for live duration display
    // True once the user (or a successful persistence restore) has set gen.repo.
    // While true, _reconcileSelectedModel() refuses to override gen.repo unless
    // the chosen model is truly gone from cachedModels — protects against
    // transient catalog-refresh races resetting the user's choice to the first
    // compatible model every 4 seconds.
    _repoUserConfirmed: false,

    // ──────── per-model preset persistence ────────
    // Mirrors voicestudio's pattern. localStorage keys:
    //   musicstudio.gen.presets  → { [repo]: { field: value, ... } }
    //   musicstudio.gen.lastRepo → last-active repo string
    // Restored after the catalog + availability lists are loaded.
    _GEN_PRESET_KEY: "musicstudio.gen.presets",
    _GEN_LAST_REPO_KEY: "musicstudio.gen.lastRepo",
    // Fields snapshotted per-repo. Picked to cover every knob a user tunes per
    // engine without dragging along transient session state (jobs, submitting,
    // currentJob) or per-prompt-attempt fields (prompt text — too volatile).
    _GEN_PRESET_FIELDS: [
      "duration", "guidance", "temperature", "steps",
      "seed", "batchCount", "chainCount", "crossfadeSeconds",
      "negativePrompt",
    ],

    // ──────── generate sub-state (music) ────────
    gen: {
      available: false,
      diffusers_available: false,
      error: null,
      device: null,
      presets: [],                 // duration_presets from /api/generate/availability
      mode: "txt2music",
      repo: "",
      prompt: "",
      negativePrompt: "",          // only used by Stable Audio
      duration: 10,                // seconds
      steps: 100,                  // Stable Audio diffusion steps; MusicGen ignores
      guidance: 3.0,               // MusicGen sweet spot; Stable Audio defaults to 7
      temperature: 1.0,            // MusicGen sampling temperature
      seed: -1,
      batchCount: 1,
      // Chain N clips into a single long WAV (server-side concat). Each clip
      // uses seed_base + i and the result is stitched with `crossfadeSeconds`
      // of linear crossfade between chunks. Useful for ambient / background
      // music that exceeds a single model's max_duration_seconds.
      chainCount: 1,
      crossfadeSeconds: 0,
      // Carryover state from imagestudio template — unused for music but kept
      // because reuseParams / other helpers reference it. Safe to remove later.
      quantize: null,
      loraNames: [],
      loraWeights: {},
      // `busy` reflects "a job is running or queued" — used by the output area
      //   to show progress. NOT used by the Generate button (would block queueing).
      busy: false,
      busyLabel: "Generating…",
      // `submitting` is transient — true ONLY during the POST. Used by the
      //   Generate button to prevent double-clicks. Cleared on a 300ms timer
      //   so the user can immediately submit again (which queues the next job).
      submitting: false,
      clearArmed: false,           // two-click confirm for Clear (webview-safe)
      deleteArmed: null,           // job.id currently armed for a two-click single delete
      pruneArmed: null,            // prune mode currently armed for a two-click confirm
      autoPlay: false,             // auto-play the newest result when a generation finishes
      jobs: [],
      currentJob: null,
    },

    // ──────── diagnostics (dependency checklist) ────────
    diag: {
      device: null,
      packages: [],          // [{package, role, installed, version, error}]
      engines: [],           // [{family, requires, missing, ready}]
      any_missing: false,
      ready_count: 0,
      total_engines: 0,
      _lastFetched: 0,
    },

    // Toast notifications (auto-dismiss after 5s)
    toasts: [],
    _toastSeq: 0,
    _jobStatePrev: {},   // map jobId → previous state, used to detect transitions for toasts

    // ──────── Models-tab library filters ────────
    modelFilters: {
      search: "",
      families: new Set(),
      statuses: new Set(),
      capabilities: new Set(),
      // v1.1.2 — quick filter chips. MLX chip auto-hides if no MLX models exist.
      mlxOnly: false,
      fitsMyMac: false,
      // v1.x — segmented RAM-fit filter, scored against the RAM slider:
      // "all" | "ok" (green) | "tight" (yellow) | "over" (red)
      fitLevel: "all",
      sortBy: "default",
      advancedOpen: false,
      openFamilies: new Set(),
      // Per-repo "show full details" toggle. Cards default to compact.
      expandedRepos: new Set(),
    },

    // ──────── settings ────────
    settings: {
      hf_token_set: false,
      hf_token_masked: "",
      tokenInput: "",
      showToken: false,
      busy: false,
      message: "",
      messageKind: "info",   // "success" | "error" | "info"
    },
    autoUpdate: {
      loaded:false, busy:false, message:"", messageKind:"info", state:"idle",
      installed_version:"", latest_version:null, last_checked:null, next_check:null,
      last_update_result:null, defer_reason:null, rollback:null, details:[],
      update_available:false, scheduler:{installed:false}, release_notes_url:"",
      settings:{mode:"off",frequency:"daily",maintenance_hour:5,idle_only:true},
      draft:{mode:"off",frequency:"daily",maintenance_hour:5,idle_only:true},
      dirty:false,
    },
    memoryPolicy: {
      mode:"performance", default_mode:"performance", idle_seconds:null,
      loaded_model:null, model_idle_seconds:null, next_release_at:null,
      last_release_at:null, last_release_reason:null, release_count:0,
      process_title:"Music Studio Mac", process_title_applied:false,
      loaded:false, busy:false, message:"", messageKind:"info",
      draft:{mode:"performance"}, dirty:false,
    },

    // ──────── network/connectivity (where the API can be reached) ────────
    conn: {
      listen_port: null,
      bind_port: 47869,        // the true uvicorn --port from start.js;
                                // refreshed from /api/connectivity on load
      bind_host: "0.0.0.0",
      request_port: null,
      scheme: "http",
      client_url: "",
      addresses: [],
      share_local_enabled: false,
      share_local_port_fixed: null,
      share_passcode_set: false,
      pinokio_ui_port: 42000,
    },

    // ──────── lifecycle ────────
    /** Measure the actual height of .topbar and expose it as a CSS variable
     *  so sticky elements below (e.g. .library-toolbar) can offset themselves
     *  correctly even when the topbar wraps to multiple rows on narrow widths. */
    _syncTopbarHeight() {
      const el = document.querySelector('.topbar');
      if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--topbar-height', h + 'px');
    },

        async init() {
      await this.refreshHealth();
      await this.refreshSystem();
      // Seed the RAM-slider budget from detected RAM (or a saved override).
      this._initRamPlanner();
      this._syncTopbarHeight();
      window.addEventListener('resize', () => this._syncTopbarHeight());
      // Also re-measure on next animation frame in case fonts/layout settle late.
      requestAnimationFrame(() => this._syncTopbarHeight());
      await this.refreshCatalog();
      // Clear stale presentation filters so a fresh visit always shows the
      // complete catalog, then open the best initial family.
      this._initFilterPreferences();
      this._initFamilyLibrary();
      // When the selected model changes, clamp gen.duration to the new model's
      // max_duration_seconds so the UI value matches the slider's new ceiling
      // (the backend clamps too, but the visible number would otherwise lie).
      this.$watch("gen.repo", () => {
        const max = this.selectedModel?.max_duration_seconds || 30;
        if (this.gen.duration > max) this.gen.duration = max;
      });
      await this.refreshGenAvailability();
      await this.refreshDiagnostics();
      await this.refreshLoras();
      await this.refreshSettings();
      await this.refreshAutoUpdate(true);
      await this.refreshMemoryPolicy(true, true);
      // Restore last-used model + per-repo gen settings AFTER catalog +
      // availability are loaded so the cachedModels list is populated when
      // we check whether lastRepo is still valid.
      this._initGenPersistence();
      this.startJobStream();
      this.startGenStream();
      this.refreshOutputStats();
      this.refreshStoragePolicy();
      // The catalog needs to reflect cache state changes during downloads,
      // so we re-poll it on a slower cadence than the per-job stream.
      this._refreshHandle = setInterval(() => this.refreshCatalog(), 4000);
      // 1Hz tick so live elapsed-time displays update without per-component timers.
      this._tickHandle = setInterval(() => { this._nowSec = Math.floor(Date.now() / 1000); }, 1000);
      setInterval(() => {
        if (this.tab === "settings" || ["checking","updating","restarting","deferred"].includes(this.autoUpdate.state)) this.refreshAutoUpdate(true);
        if (this.tab === "settings") this.refreshMemoryPolicy(true);
      }, 5000);
      // Route via hash so the sidebar buttons in pinokio.js can deep-link.
      const applyHash = () => {
        const h = (location.hash || "").replace(/^#\/?/, "");
        if (["generate", "models", "downloads", "imports", "api", "settings"].includes(h)) this.tab = h;
        if (h === "imports") this.scanImports();
        if (h === "settings") { this.refreshSettings(); this.refreshAutoUpdate(true); this.refreshMemoryPolicy(true); }
      };
      window.addEventListener("hashchange", applyHash);
      applyHash();

      // ── Keyboard shortcuts ──
      // Cmd/Ctrl+Enter from anywhere on the Generate tab submits.
      // (The textarea already has its own @keydown.cmd.enter; this global
      // handler covers focus on other controls.)
      document.addEventListener("keydown", (e) => {
        const isMeta = e.metaKey || e.ctrlKey;
        if (isMeta && e.key === "Enter" && this.tab === "generate") {
          e.preventDefault();
          this.submitGenerate();
        } else if (e.key === "Escape") {
          if (this.pendingDownload) this.pendingDownload = null;
        }
      });

      // ── Clipboard paste → input image (img2img only) ──
      // Listens app-wide; only consumes the paste if the user is on the
      // Generate tab in img2img mode, so we don't steal pastes from textareas
      // / other inputs.
      document.addEventListener("paste", (e) => {
        if (this.tab !== "generate" || this.gen.mode !== "img2img") return;
        const items = e.clipboardData?.items || [];
        for (const it of items) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const blob = it.getAsFile();
            if (blob) {
              e.preventDefault();
              this.setInputImage(blob, blob.name || "pasted-image.png");
              return;
            }
          }
        }
      });
    },

    // ──────── derived ────────
    get modelsByFamily() {
      const out = {};
      for (const m of this.models) {
        (out[m.family] ||= []).push(m);
      }
      return out;
    },

    // ─── Library filters (Models tab) ─────────────────────────────────
    // ─── RAM slider + client-side hardware fit ────────────────────────
    /** Effective RAM budget (GB) for fit scoring: slider value, else
     *  detected RAM, else a neutral 16 GB. */
    get effectiveRam() {
      return this.ramGb || this.system.unified_memory_gb || 16;
    },
    /** Client-side fit verdict for a model's memory floor vs effectiveRam.
     *  Mirrors backend system_info.fit_for() (1.5× comfortable / 1.0× tight /
     *  below = over budget) so the RAM slider re-scores every card instantly. */
    fitFor(minGb) {
      const actual = this.effectiveRam;
      const floor = Math.max(Number(minGb) || 0, 1);
      const headroom = actual / floor;
      let state;
      if (headroom >= 1.5)      state = "ok";
      else if (headroom >= 1.0) state = "tight";
      else                      state = "risky";
      const hint = headroom >= 1.5
        ? `${actual} GB is ≥1.5× this model's ${minGb} GB floor — comfortable headroom.`
        : headroom >= 1.0
          ? `${actual} GB just clears the ${minGb} GB floor — close other apps before loading.`
          : `${actual} GB is below the ${minGb} GB floor — it would swap heavily or fail to load.`;
      return { state, actual_gb: actual, required_gb: Number(minGb) || 0, hint };
    },
    setRam(gb) {
      const v = Math.max(1, Math.min(1024, Math.round(Number(gb) || 0)));
      this.ramGb = v;
      this.ramIsDetected = (v === this.system.unified_memory_gb);
      this._persistFilterPref("ramGb", v);
    },
    resetRamToDetected() {
      const d = this.system.unified_memory_gb;
      if (d) this.setRam(d);
    },
    /** Seed the RAM slider from a saved override or the detected RAM. */
    _initRamPlanner() {
      try {
        const saved = localStorage.getItem("musicstudio.modelFilters.ramGb");
        if (saved !== null && !isNaN(+saved)) {
          this.ramGb = +saved;
          this.ramIsDetected = (+saved === this.system.unified_memory_gb);
          return;
        }
      } catch {}
      this.ramGb = this.system.unified_memory_gb || 16;
      this.ramIsDetected = !!this.system.unified_memory_gb;
    },
    /** "✨ Best for your RAM" — the highest-quality model in each lane that
     *  still fits the current budget (fit ≠ risky). "Highest quality" ≈ the
     *  heaviest tier that fits, nudged by a "recommended" label. Live. */
    get bestPicks() {
      const fits  = (m) => this.fitFor(m.min_unified_memory_gb).state !== "risky"
        && this.isModelReady(m.repo);
      const score = (m) => (Number(m.min_unified_memory_gb) || 0) * 1000
                         + (Number(m.size_gb) || 0) * 10
                         + (/recommended/i.test(m.label || "") ? 5 : 0);
      const pick = (predicate) => {
        const c = (this.models || []).filter(m => fits(m) && predicate(m));
        if (!c.length) return null;
        return c.slice().sort((a, b) => score(b) - score(a))[0];
      };
      const hasCap = (m, cap) => (m.capabilities || []).includes(cap);
      const buckets = [
        { id: "overall",  label: "Best overall",          icon: "🏆", model: pick(() => true) },
        { id: "music",    label: "Best text-to-music",     icon: "🎵", model: pick(m => hasCap(m, "text-to-music")) },
        { id: "stereo",   label: "Best stereo",            icon: "🔊", model: pick(m => hasCap(m, "stereo")) },
        { id: "sfx",      label: "Best sound effects",     icon: "💥", model: pick(m => hasCap(m, "sound-effects")) },
      ];
      const seen = new Set();
      return buckets.filter(b => {
        if (!b.model || seen.has(b.model.repo)) return false;
        seen.add(b.model.repo);
        return true;
      });
    },

    get filteredModelsByFamily() {
      const f = this.modelFilters;
      const q = (f.search || "").trim().toLowerCase();
      const matches = (m) => {
        if (f.families.size > 0 && !f.families.has(m.family)) return false;
        if (f.statuses.size > 0) {
          const state = m.cache?.state || "absent";
          const isReady = this.isModelReady ? this.isModelReady(m.repo) : (state === "cached");
          const matchesState = f.statuses.has(state)
            || (f.statuses.has("engine-ready") && state === "cached" && isReady);
          if (!matchesState) return false;
        }
        if (f.capabilities.size > 0) {
          const caps = new Set(m.capabilities || []);
          for (const wanted of f.capabilities) {
            if (!caps.has(wanted)) return false;
          }
        }
        // Apple Silicon (MLX) — only relevant if catalog has MLX entries.
        // Music's catalog is currently 0 MLX; chip is auto-hidden in HTML.
        if (f.mlxOnly && !m.apple_optimized) return false;
        // Segmented RAM-fit filter — scored live against the RAM slider.
        if (f.fitLevel && f.fitLevel !== "all") {
          const st = this.fitFor(m.min_unified_memory_gb).state;
          if (f.fitLevel === "ok"    && st !== "ok")    return false;
          if (f.fitLevel === "tight" && st !== "tight") return false;
          if (f.fitLevel === "over"  && st !== "risky") return false;
        }
        // Legacy "Fits my Mac" — exclude "risky"; now scored client-side too.
        if (f.fitsMyMac && this.fitFor(m.min_unified_memory_gb).state === "risky") return false;
        if (q) {
          const hay = ((m.label || "") + " " + (m.family_label || "") + " "
            + (m.variant_label || "") + " " + (m.quality_label || "") + " "
            + (m.speed_label || "") + " " + (m.runtime || "") + " "
            + (m.repo || "") + " " + (m.best_for || "")).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      };
      const out = {};
      for (const m of this.models) {
        if (!matches(m)) continue;
        (out[m.family] ||= []).push(m);
      }
      const cmp = (() => {
        switch (f.sortBy) {
          case "name":      return (a, b) => (a.label || "").localeCompare(b.label || "");
          case "size-asc":  return (a, b) => (a.size_gb || 0) - (b.size_gb || 0);
          case "size-desc": return (a, b) => (b.size_gb || 0) - (a.size_gb || 0);
          default:          return (a, b) => (a.size_gb || 0) - (b.size_gb || 0);
        }
      })();
      for (const fam of Object.keys(out)) out[fam].sort(cmp);
      return out;
    },
    get availableCapabilities() {
      const set = new Set();
      for (const m of this.models) for (const c of (m.capabilities || [])) set.add(c);
      const order = {
        "text-to-music": 0,
        "sound-effects": 2,
        vocal: 3,
        stereo: 4,
      };
      return Array.from(set).sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99) || a.localeCompare(b));
    },
    get availableFamilies() {
      const seen = new Set();
      const out = [];
      for (const m of this.models) {
        if (seen.has(m.family)) continue;
        seen.add(m.family);
        out.push({ id: m.family, label: m.family_label || this.families?.[m.family]?.label || m.family });
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    },
    get filteredModelTotalCount() {
      return Object.values(this.filteredModelsByFamily).reduce((s, list) => s + list.length, 0);
    },
    /** Family-first view model. Downloaded families come first, then families
     *  with an option that fits the selected RAM budget. */
    get visibleFamilies() {
      const families = Object.values(this.families || {})
        .map((f, index) => ({ ...f, catalogOrder: index, models: this.filteredModelsByFamily[f.id] || [] }))
        .filter(f => f.models.length > 0);
      const rank = (f) => {
        const cached = f.models.some(m => m.cache?.state === "cached") ? 0 : 1;
        const ready = f.models.some(m => this.isModelReady(m.repo)) ? 0 : 1;
        const fits = f.models.some(m => this.fitFor(m.min_unified_memory_gb).state !== "risky") ? 0 : 1;
        return cached * 1000 + ready * 100 + fits * 10;
      };
      return families.sort((a, b) => rank(a) - rank(b) || a.catalogOrder - b.catalogOrder);
    },
    familyCapabilities(family) {
      const caps = new Set();
      for (const m of (family.models || [])) {
        for (const cap of (m.capabilities || [])) caps.add(cap);
      }
      return Array.from(caps);
    },
    familyRuntimeLabel(family) {
      const runtimes = new Set((family.models || []).map(m => m.runtime).filter(Boolean));
      return runtimes.size === 1 ? Array.from(runtimes)[0] : "Multiple pipelines";
    },
    familyMemoryLabel(family) {
      const floors = (family.models || []).map(m => Number(m.min_unified_memory_gb) || 0);
      return floors.length ? `from ${Math.min(...floors)} GB RAM` : "RAM varies";
    },
    familyDurationLabel(family) {
      const limits = (family.models || []).map(m => Number(m.max_duration_seconds) || 0);
      const max = limits.length ? Math.max(...limits) : 0;
      return max >= 60 ? `up to ${Math.round(max / 60)} min` : `up to ${max}s`;
    },
    familyCachedCount(family) {
      return (family.models || []).filter(m => m.cache?.state === "cached").length;
    },
    isRecommendedFamily(family) {
      return !!this.bestPicks[0]
        && (family.models || []).some(m => m.repo === this.bestPicks[0].model.repo);
    },
    familyTone(family) {
      const caps = this.familyCapabilities(family);
      if (caps.includes("vocal")) return "tone-vocal";
      if (caps.includes("sound-effects") && !caps.includes("text-to-music")) return "tone-sfx";
      if (family.id === "stable-audio") return "tone-diffusion";
      return "tone-music";
    },
    get hasActiveFilters() {
      const f = this.modelFilters;
      return !!(f.search.trim() || f.families.size || f.statuses.size || f.capabilities.size
                || f.mlxOnly || f.fitsMyMac || (f.fitLevel && f.fitLevel !== "all"));
    },
    /** Human-readable list of every active filter — used by the empty state
     *  so users can SEE what cut their results and tap a single filter off. */
    activeFilterSummary() {
      const f = this.modelFilters;
      const out = [];
      if (f.search.trim()) {
        out.push({ label: `search: "${f.search.trim()}"`, removeFn: () => this.modelFilters.search = "" });
      }
      for (const fam of f.families) {
        const famLabel = this.availableFamilies.find(x => x.id === fam)?.label || fam;
        out.push({ label: `family: ${famLabel}`, removeFn: () => this.toggleFamilyFilter(fam) });
      }
      for (const status of f.statuses) {
        out.push({ label: `status: ${status}`, removeFn: () => this.toggleStatusFilter(status) });
      }
      for (const cap of f.capabilities) {
        out.push({ label: `capability: ${cap}`, removeFn: () => this.toggleCapabilityFilter(cap) });
      }
      if (f.mlxOnly) {
        out.push({ label: "🍎 MLX only", removeFn: () => this.toggleMlxFilter() });
      }
      if (f.fitsMyMac) {
        out.push({ label: "🖥 Fits my Mac", removeFn: () => this.toggleFitsMyMacFilter() });
      }
      if (f.fitLevel && f.fitLevel !== "all") {
        const lbl = { ok: "✓ Fits", tight: "⚠ Tight", over: "✗ Over budget" }[f.fitLevel] || f.fitLevel;
        out.push({ label: `RAM fit: ${lbl}`, removeFn: () => this.modelFilters.fitLevel = "all" });
      }
      return out;
    },
    toggleFamilyFilter(familyId) {
      const s = this.modelFilters.families;
      if (s.has(familyId)) s.delete(familyId); else s.add(familyId);
      this.modelFilters.families = new Set(s);
    },
    toggleStatusFilter(status) {
      const s = this.modelFilters.statuses;
      if (s.has(status)) s.delete(status); else s.add(status);
      this.modelFilters.statuses = new Set(s);
    },
    toggleCapabilityFilter(cap) {
      const s = this.modelFilters.capabilities;
      if (s.has(cap)) s.delete(cap); else s.add(cap);
      this.modelFilters.capabilities = new Set(s);
    },
    toggleMlxFilter() {
      this.modelFilters.mlxOnly = !this.modelFilters.mlxOnly;
    },
    toggleFitsMyMacFilter() {
      this.modelFilters.fitsMyMac = !this.modelFilters.fitsMyMac;
    },
    /** Helper: write a filter preference to localStorage. App-namespaced. */
    _persistFilterPref(name, value) {
      try {
        localStorage.setItem(`musicstudio.modelFilters.${name}`, String(value));
      } catch {}
    },
    /** Format/fit filters are intentionally session-only. Opening Models must
     *  never silently hide most of the catalog because of an old preference. */
    _initFilterPreferences() {
      try {
        this.modelFilters.mlxOnly = false;
        this.modelFilters.fitsMyMac = false;
        localStorage.removeItem("musicstudio.modelFilters.mlxOnly");
        localStorage.removeItem("musicstudio.modelFilters.fitsMyMac");
      } catch {}
    },
    _initFamilyLibrary() {
      if (this.modelFilters.openFamilies.size > 0) return;
      const cached = this.models.find(m => m.cache?.state === "cached");
      const fitting = this.models.find(m => this.fitFor(m.min_unified_memory_gb).state !== "risky");
      const first = cached || fitting || this.models[0];
      this.modelFilters.openFamilies = new Set(first ? [first.family] : []);
    },

    // ──────── per-model gen-state persistence ────────
    _loadAllGenPresets() {
      try {
        const raw = localStorage.getItem(this._GEN_PRESET_KEY);
        return raw ? (JSON.parse(raw) || {}) : {};
      } catch { return {}; }
    },
    _saveAllGenPresets(map) {
      try { localStorage.setItem(this._GEN_PRESET_KEY, JSON.stringify(map)); } catch {}
    },
    /** Snapshot the current gen.* fields into localStorage under gen.repo. */
    _saveCurrentGenPreset() {
      const repo = this.gen.repo;
      if (!repo) return;
      const map = this._loadAllGenPresets();
      const preset = {};
      for (const f of this._GEN_PRESET_FIELDS) preset[f] = this.gen[f];
      map[repo] = preset;
      this._saveAllGenPresets(map);
      try { localStorage.setItem(this._GEN_LAST_REPO_KEY, repo); } catch {}
    },
    /** Pull the stored preset for `repo` into the live gen.* fields. No-op
     *  when no preset exists yet — fields keep whatever default the previous
     *  repo left behind. */
    _restoreGenPresetForRepo(repo) {
      if (!repo) return;
      const preset = this._loadAllGenPresets()[repo];
      if (!preset) return;
      for (const f of this._GEN_PRESET_FIELDS) {
        if (preset[f] !== undefined) this.gen[f] = preset[f];
      }
    },
    /** Called once after init() has the catalog + availability lists. Restores
     *  the last-used repo (if it's still cached) and its preset, then arms
     *  watchers so further changes persist automatically. */
    _initGenPersistence() {
      try {
        const lastRepo = localStorage.getItem(this._GEN_LAST_REPO_KEY);
        if (lastRepo && this.cachedModels.some(m => m.repo === lastRepo)) {
          this.gen.repo = lastRepo;
          // Mark as authoritative so the 4s catalog poll's _reconcileSelectedModel
          // doesn't override this restore on a transient cache-state hiccup.
          this._repoUserConfirmed = true;
        } else if (this.gen.repo) {
          // No saved lastRepo, but refreshCatalog() already picked a default.
          // Treat that as authoritative too — otherwise the poll could keep
          // re-snapping it if the catalog order changes between requests.
          this._repoUserConfirmed = true;
        }
      } catch {}
      this._restoreGenPresetForRepo(this.gen.repo);

      // Watchers — registered AFTER the initial restore so the restore itself
      // doesn't fire a redundant save round. Any repo change after init counts
      // as a user-authoritative choice.
      this.$watch("gen.repo", (newRepo) => {
        if (newRepo) this._repoUserConfirmed = true;
        this._restoreGenPresetForRepo(newRepo);
        this._saveCurrentGenPreset();
      });
      for (const f of this._GEN_PRESET_FIELDS) {
        this.$watch(`gen.${f}`, () => this._saveCurrentGenPreset());
      }
    },

    /** Per-card expand/collapse (cards default to compact). */
    isModelExpanded(repo) {
      return this.modelFilters.expandedRepos.has(repo);
    },
    toggleModelExpanded(repo) {
      const s = this.modelFilters.expandedRepos;
      if (s.has(repo)) s.delete(repo); else s.add(repo);
      this.modelFilters.expandedRepos = new Set(s);
    },
    expandAllVisible() {
      const s = new Set(this.modelFilters.expandedRepos);
      for (const list of Object.values(this.filteredModelsByFamily)) {
        for (const m of list) s.add(m.repo);
      }
      this.modelFilters.expandedRepos = s;
    },
    collapseAllVisible() {
      this.modelFilters.expandedRepos = new Set();
    },
    toggleFamilyOpen(familyId) {
      const s = this.modelFilters.openFamilies;
      if (s.has(familyId)) s.delete(familyId); else s.add(familyId);
      this.modelFilters.openFamilies = new Set(s);
    },
    isFamilyFiltered(familyId)   { return this.modelFilters.families.has(familyId); },
    isStatusFiltered(status)     { return this.modelFilters.statuses.has(status); },
    isCapFiltered(cap)           { return this.modelFilters.capabilities.has(cap); },
    isFamilyOpen(familyId) {
      return this.modelFilters.openFamilies.has(familyId)
        || !!this.modelFilters.search.trim()
        || this.modelFilters.families.has(familyId);
    },
    clearAllFilters() {
      this.modelFilters.search = "";
      this.modelFilters.families = new Set();
      this.modelFilters.statuses = new Set();
      this.modelFilters.capabilities = new Set();
      this.modelFilters.mlxOnly = false;
      this.modelFilters.fitsMyMac = false;
      this.modelFilters.fitLevel = "all";
      this.modelFilters.sortBy = "default";
      // expandedRepos intentionally NOT reset — separate user concern.
      // ramGb intentionally NOT reset — it's a hardware setting, not a filter.
    },

    get activeDownloadCount() {
      return this.jobs.filter(j => ["queued", "running", "cancelling"].includes(j.state)).length;
    },

    get finishedDownloadCount() {
      return this.jobs.filter(j => ["done", "error", "cancelled"].includes(j.state)).length;
    },

    // ──────── generate-tab derived ────────
    get cachedModels() {
      return this.models.filter(m => m.cache?.state === "cached");
    },

    get modeCompatibleModels() {
      // Show only cached models that declare support for the current Generate
      // subtab. Keeps the dropdown short and prevents picking an edit-incapable
      // model on the Edit subtab.
      const mode = this.gen.mode || "txt2img";
      return this.cachedModels.filter(m => (m.capabilities || []).includes(mode));
    },

    get selectedModel() {
      return this.cachedModels.find(m => m.repo === this.gen.repo) || null;
    },

    /** Duration preset chips, scaled to the selected model's max_duration_seconds.
     *  Returns up to 4 sensible shortcuts (5 / 10 / half / full). Duplicates and
     *  anything above the model's ceiling are filtered out. */
    get durationPresets() {
      const max = this.selectedModel?.max_duration_seconds || 30;
      const raw = [5, 10, Math.round(max / 2), max];
      const seen = new Set();
      const out = [];
      for (const v of raw) {
        if (v < 1 || v > max) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    },

    /** Approximate final WAV length after chain + crossfade is applied. */
    get chainedTotalSeconds() {
      const dur = Math.max(1, Number(this.gen.duration) || 0);
      const n = Math.max(1, Math.min(8, this.gen.chainCount | 0));
      const cf = Math.max(0, Number(this.gen.crossfadeSeconds) || 0);
      return Math.max(0, dur * n - cf * (n - 1));
    },

    /** Whether the Generate button can be clicked right now.
     *  Intentionally does NOT include `gen.busy` — a running job is fine to
     *  queue behind. Backend's _GEN_LOCK serializes execution. */
    get canSubmit() {
      if (!this.gen.available) return false;
      if (this.cachedModels.length === 0) return false;
      if (!this.gen.repo) return false;
      if (!this.gen.prompt.trim()) return false;
      if (this.gen.submitting) return false;
      if (this.gen.repo && !this.isModelReady(this.gen.repo)) return false;
      return true;
    },

    // ─── Queue UX (Level 1: surface pending/running jobs) ─────────────
    get pendingJobs() {
      return (this.gen.jobs || [])
        .filter(j => j.state === "queued" || j.state === "running")
        .sort((a, b) => (a.started_at || 0) - (b.started_at || 0));
    },
    get queuedCount() {
      return (this.gen.jobs || []).filter(j => j.state === "queued").length;
    },
    get runningJob() {
      return (this.gen.jobs || []).find(j => j.state === "running") || null;
    },
    get hasPending() {
      return this.pendingJobs.length > 0;
    },
    /** Cancel an individual queued / running job from the queue UI. The
     *  backend's DELETE handles both cases:
     *  - queued: backend immediately flips state → "cancelled" so the UI
     *    reflects it on the next SSE snapshot (~1 s). The worker still
     *    safely no-ops when it later wakes up and sees cancel_event set.
     *  - running: MusicGen, Stable Audio, and Bark generation calls are
     *    blocking and don't honor mid-flight cancellation. We can only set
     *    cancel_event so the result is discarded after generation finishes. */
    async cancelPending(job) {
      if (!job || !job.id) return;
      const wasRunning = job.state === "running";
      try {
        const r = await fetch("/api/generate/jobs/" + encodeURIComponent(job.id), { method: "DELETE" });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          this.pushToast({ kind: "warn", icon: "⚠", title: "Couldn't cancel",
            body: (err && err.detail) || ("HTTP " + r.status) });
          return;
        }
        if (wasRunning) {
          this.pushToast({
            kind: "info", icon: "⏸",
            title: "Cancel signal sent",
            body: "Running jobs can't stop mid-generation (MusicGen / Stable Audio / Bark don't honor cancellation). " +
                  "The result will be discarded when generation finishes.",
          });
        } else {
          this.pushToast({ kind: "info", icon: "✓", title: "Cancelled", body: "Queued job removed." });
        }
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Cancel failed", body: String(e) });
      }
    },
    truncateText(s, n = 80) {
      if (!s) return "";
      return s.length > n ? s.slice(0, n) + "…" : s;
    },

    // ─── History pagination + richer metadata ─────────────────────────
    historyPage: 0,
    historyPageSize: 10,
    get historyJobs() {
      return (this.gen.jobs || [])
        .filter(j => j.state === "done" || j.state === "error" || j.state === "cancelled")
        .slice(1);   // index 0 is "Latest generation"
    },
    get historyPageCount() {
      return Math.max(1, Math.ceil(this.historyJobs.length / this.historyPageSize));
    },
    get pagedHistoryJobs() {
      const last = Math.max(0, this.historyPageCount - 1);
      if (this.historyPage > last) this.historyPage = last;
      const start = this.historyPage * this.historyPageSize;
      return this.historyJobs.slice(start, start + this.historyPageSize);
    },
    historyNextPage() { if (this.historyPage < this.historyPageCount - 1) this.historyPage += 1; },
    historyPrevPage() { if (this.historyPage > 0) this.historyPage -= 1; },
    historyModelLabel(job) {
      const repo = job?.params?.repo;
      if (!repo) return "(unknown model)";
      const m = (this.models || []).find(x => x.repo === repo);
      return m?.label || repo;
    },
    /** Music-side params summary: duration + guidance + (steps for Stable Audio) + temperature. */
    historyParamsLabel(job) {
      const p = job?.params || {};
      const m = (this.models || []).find(x => x.repo === p.repo);
      const family = m?.family;
      const parts = [];
      if (typeof p.duration === "number") parts.push(p.duration + "s");
      if (typeof p.chain_count === "number" && p.chain_count > 1) {
        let label = "×" + p.chain_count;
        if (typeof p.crossfade_seconds === "number" && p.crossfade_seconds > 0) {
          label += " (xf " + p.crossfade_seconds + "s)";
        }
        parts.push(label);
      }
      if (typeof p.guidance === "number") parts.push("guidance " + p.guidance);
      if (family === "stable-audio" && typeof p.steps === "number") parts.push(p.steps + " steps");
      if (typeof p.temperature === "number" && family !== "stable-audio") parts.push("temp " + p.temperature);
      if (p.bark_voice_preset) parts.push("voice " + p.bark_voice_preset);
      return parts.join(" · ");
    },

    // ──────── per-model dependency lookup (wired to diagnostics) ────────
    modelEngine(repo) {
      const m = (this.models || []).find(x => x.repo === repo);
      if (!m) return null;
      return (this.diag.engines || []).find(e => e.family === m.family) || null;
    },
    isModelReady(repo) {
      if (!repo) return false;
      const e = this.modelEngine(repo);
      if (!e) return true;   // unknown engine → assume ready; API will 503 if not
      return !!e.ready;
    },
    modelMissingDeps(repo) {
      const e = this.modelEngine(repo);
      return e ? (e.missing || []) : [];
    },
    modelDepsOk(repo) {
      // Packages are importable — the family just might not have a worker wired up yet.
      const e = this.modelEngine(repo);
      if (!e) return true;
      if (typeof e.deps_ok === "boolean") return e.deps_ok;
      return !!e.ready;
    },
    modelOptionLabel(m) {
      const e = (this.diag.engines || []).find(x => x.family === m.family);
      if (!e || e.ready) return m.label;
      return `⚠ ${m.label} — needs ${(e.missing || []).join(", ")}`;
    },

    get canRuntimeQuant() {
      // Only full checkpoints accept runtime quantization. Pre-quantized MLX
      // variants are already at their final precision.
      const m = this.selectedModel;
      return !!m && !m.apple_optimized;
    },

    get outputFrameStyle() {
      const w = this.gen.width || 1024;
      const h = this.gen.height || 1024;
      return `aspect-ratio: ${w} / ${h};`;
    },

    // FLUX text encoders (T5-XXL for FLUX.1, similar for FLUX.2) typically take
    // ~512 tokens. Tokens ≠ characters, but for English ~3-4 chars per token is
    // a reasonable rule of thumb. 1500 chars ≈ 400–500 tokens, so we warn near
    // there. This is intentionally a soft limit — we don't block submission.
    get promptSoftLimit() {
      // Future hook: vary per model. For now FLUX-family models all share roughly
      // the same encoder ceiling.
      return 1500;
    },

    // ──────── API tab derived ────────
    get apiBase() {
      return window.location.origin;
    },

    get curlExample() {
      const base = this.apiBase;
      const repo = this.gen.repo || "facebook/musicgen-small";
      const body = JSON.stringify({
        repo,
        prompt: "warm ambient pads, slow evolving, contemplative",
        duration: 10, guidance: 3.0, temperature: 1.0, seed: -1,
      });
      return [
        "# 1. Start music generation — returns a job id immediately",
        "curl -s -X POST " + base + "/api/generate/txt2music \\",
        "  -H 'content-type: application/json' \\",
        "  -d '" + body + "'",
        "# → returns: {\"job\": {\"id\": \"abc123\", \"state\": \"queued\", ...}}",
        "",
        "# 2. Poll the job until state == done",
        "curl -s " + base + "/api/generate/jobs/abc123",
        "",
        "# 3. Save the WAV to disk",
        "curl -s -o track.wav " + base + "/api/generate/jobs/abc123/audio",
      ].join("\n");
    },

    get jsExample() {
      const base = this.apiBase;
      const repo = this.gen.repo || "facebook/musicgen-small";
      const lines = [
        "const SERVER = " + JSON.stringify(base) + ";",
        "",
        "// 1. Kick off generation",
        "const start = await fetch(SERVER + '/api/generate/txt2music', {",
        "  method: 'POST',",
        "  headers: { 'content-type': 'application/json' },",
        "  body: JSON.stringify({",
        "    repo: " + JSON.stringify(repo) + ",",
        "    prompt: 'warm ambient pads, slow evolving, contemplative',",
        "    duration: 10, guidance: 3.0, temperature: 1.0, seed: -1,",
        "  }),",
        "}).then(r => r.json());",
        "",
        "// 2. Poll once per second until done",
        "let job = start.job;",
        "while (job.state !== 'done' && job.state !== 'error') {",
        "  await new Promise(r => setTimeout(r, 1000));",
        "  job = (await fetch(SERVER + '/api/generate/jobs/' + job.id).then(r => r.json())).job;",
        "}",
        "if (job.state === 'error') throw new Error(job.error);",
        "",
        "// 3. job.output_url is a relative path — fetch and play as a Blob",
        "const blob = await fetch(SERVER + job.output_url).then(r => r.blob());",
        "const url = URL.createObjectURL(blob);",
        "new Audio(url).play();",
      ];
      return lines.join("\n");
    },

    get reDownloadExample() {
      const base = this.apiBase;
      const sampleId = this.gen.jobs.find(j => j.state === "done")?.id || "abc123def456";
      return [
        "# Inspect job metadata (params, seed, output_url, duration, state)",
        "curl -s " + base + "/api/generate/jobs/" + sampleId + " | jq",
        "",
        "# Re-download the WAV",
        "curl -s -o track.wav " + base + "/api/generate/jobs/" + sampleId + "/audio",
        "",
        "# Python equivalent",
        "import requests",
        "r = requests.get(" + JSON.stringify(base + "/api/generate/jobs/" + sampleId) + ").json()",
        "print('seed used:', r['job']['resolved_seed'])",
        "print('prompt:', r['job']['params']['prompt'])",
        "audio = requests.get(" + JSON.stringify(base + "/api/generate/jobs/" + sampleId + "/audio") + ").content",
        "open('track.wav', 'wb').write(audio)",
      ].join("\n");
    },

    get listJobsExample() {
      const base = this.apiBase;
      return [
        "# Returns ALL persisted jobs (last 200), latest first",
        "curl -s " + base + "/api/generate/jobs | jq",
        "",
        "# Just the ids + prompts, for quick browsing",
        "curl -s " + base + "/api/generate/jobs | \\",
        "  jq -r '.jobs[] | \"\\(.id)  \\(.state)  \\(.params.prompt // \"(no prompt)\")\"'",
        "",
        "# Find a job by prompt fragment",
        "curl -s " + base + "/api/generate/jobs | \\",
        "  jq '.jobs[] | select(.params.prompt | test(\"sunset\"; \"i\"))'",
      ].join("\n");
    },

    get pythonExample() {
      const base = this.apiBase;
      const repo = this.gen.repo || "facebook/musicgen-small";
      const lines = [
        "import time, requests",
        "",
        "SERVER = " + JSON.stringify(base),
        "",
        "# 1. Kick off generation",
        "r = requests.post(f'{SERVER}/api/generate/txt2music', json={",
        "    'repo': " + JSON.stringify(repo) + ",",
        "    'prompt': 'warm ambient pads, slow evolving, contemplative',",
        "    'duration': 10, 'guidance': 3.0, 'temperature': 1.0, 'seed': -1,",
        "})",
        "r.raise_for_status()",
        "job_id = r.json()['job']['id']",
        "",
        "# 2. Poll until done",
        "while True:",
        "    job = requests.get(f'{SERVER}/api/generate/jobs/{job_id}').json()['job']",
        "    if job['state'] == 'done':",
        "        break",
        "    if job['state'] == 'error':",
        "        raise RuntimeError(job['error'])",
        "    time.sleep(1)",
        "",
        "# 3. Save the WAV",
        "audio = requests.get(f'{SERVER}/api/generate/jobs/{job_id}/audio').content",
        "with open('track.wav', 'wb') as f:",
        "    f.write(audio)",
        "print(f\"saved track.wav ({len(audio)//1024} KB, {job['duration_seconds']:.1f}s)\")",
      ];
      return lines.join("\n");
    },

    // ──────── fetch helpers ────────
    /** Fetch the host's chip + RAM snapshot. Used once at init — hardware
     *  doesn't change while the app is running. */
    async refreshSystem() {
      try {
        const r = await fetch("/api/system");
        this.system = await r.json();
      } catch {
        // Leave defaults — fit chips render as "unknown", banner stays hidden.
      }
    },

    async refreshHealth() {
      try {
        const r = await fetch("/api/health");
        this.health = await r.json();
      } catch {
        this.health = { ok: false };
      }
    },

    async refreshCatalog() {
      try {
        const r = await fetch("/api/catalog");
        const data = await r.json();
        this.families = data.families;
        this.models = data.models;
        this._reconcileSelectedModel();
      } catch {
        /* keep last good state */
      }
    },

    _reconcileSelectedModel() {
      // The <select> visually displays the first option even when gen.repo is
      // empty, but Alpine's x-model only updates on user change events. Without
      // this, submitGenerate() trips its "pick a cached model" guard even
      // though the UI looks like one is selected. So we pick the first
      // mode-compatible cached model on load, and re-pick if the user's choice
      // truly disappears from the cached list.
      //
      // IMPORTANT: this is called on EVERY catalog refresh (every 4s via the
      // polling interval). If the user has authoritatively chosen a model
      // (`_repoUserConfirmed=true`), we MUST NOT override it just because a
      // transient catalog payload doesn't list it as "mode compatible" — only
      // a genuine disappearance from cachedModels should trigger a reset.
      // Previously this used `modeCompatibleModels` which made any momentary
      // race (cache.status_snapshot reporting "partial" while a download is
      // being indexed, etc.) snap the selection back to the first model.
      const currentRepo = this.gen.repo;
      const cached = this.cachedModels;

      if (this._repoUserConfirmed && currentRepo) {
        // User has made an explicit choice. Keep it as long as it's still
        // cached at all — don't second-guess based on capability filters.
        if (cached.some(m => m.repo === currentRepo)) return;
      } else if (currentRepo && cached.some(m => m.repo === currentRepo)) {
        // No user confirmation yet but gen.repo somehow already matches a
        // cached model (e.g. set by some other code path) — treat that as
        // valid too. The dropdown only shows cachedModels anyway.
        return;
      }

      // gen.repo is empty OR the chosen model is no longer cached. Snap to
      // the first compatible cached model as a sensible default.
      const compatible = this.modeCompatibleModels;
      this.gen.repo = compatible[0]?.repo || cached[0]?.repo || "";
    },

    setMode(mode) {
      // Mode switch: update the selected model to one compatible with the new
      // mode so the picker isn't stuck on something that can't run.
      this.gen.mode = mode;
      this._reconcileSelectedModel();
      // Sensible defaults per mode
      if (mode === "edit") {
        // Edit usually wants to preserve more of the input than img2img
        if (this.gen.imageStrength < 0.7) this.gen.imageStrength = 0.85;
        // klein-edit is distilled — guidance pinned to 1.0 internally
        if (this.gen.guidance > 1.5) this.gen.guidance = 1.0;
      }
    },

    startJobStream() {
      if (this._streamHandle) this._streamHandle.close();
      const es = new EventSource("/api/downloads/stream");
      es.addEventListener("snapshot", e => {
        try {
          const payload = JSON.parse(e.data);
          this.jobs = payload.jobs || [];
        } catch { /* swallow */ }
      });
      es.onerror = () => {
        // Browser will auto-reconnect; just trace once for debugging.
        // console.debug("SSE disconnected, will reconnect");
      };
      this._streamHandle = es;
    },

    // ──────── download flow ────────
    confirmDownload(model) {
      this.pendingDownload = model;
      this.downloadToken = "";
    },

    async startDownload() {
      if (!this.pendingDownload) return;
      const body = {
        repo: this.pendingDownload.repo,
        token: this.downloadToken || null,
      };
      this.pendingDownload = null;
      try {
        await fetch("/api/downloads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        await this.refreshCatalog();
      } catch (e) {
        alert("Failed to start download: " + e);
      }
    },

    async cancelDownload(jobId) {
      try {
        await fetch("/api/downloads/" + encodeURIComponent(jobId), { method: "DELETE" });
      } catch { /* surfaced via stream on next tick */ }
    },

    // ──────── settings ────────
    async refreshSettings() {
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        this.settings.hf_token_set = !!data.hf_token_set;
        this.settings.hf_token_masked = data.hf_token_masked || "";
      } catch { /* keep last */ }
      // Connectivity panel is on the same tab — refresh it at the same time.
      await this.refreshConnectivity();
    },

    async refreshAutoUpdate(silent=false) {
      try {
        const r = await fetch("/api/auto-update/status", {cache:"no-store"});
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
        this.applyAutoUpdateStatus(data);
      } catch (e) {
        if (!silent) { this.autoUpdate.message=String(e.message||e); this.autoUpdate.messageKind="error"; }
      }
    },
    applyAutoUpdateStatus(data, forceDraft=false) {
      const savedSettings = data.settings ? {...data.settings} : null;
      Object.assign(this.autoUpdate, data, {loaded:true});
      // Status refreshes every five seconds while Settings is open. Keep an
      // in-progress form draft intact instead of replacing it with the last
      // saved server settings (the old behavior made controls snap back).
      if (savedSettings && (forceDraft || !this.autoUpdate.dirty)) {
        this.autoUpdate.draft = savedSettings;
        this.autoUpdate.dirty = false;
      }
    },
    markAutoUpdateDirty() {
      this.autoUpdate.dirty = true;
      this.autoUpdate.message = "";
      this.autoUpdate.messageKind = "info";
    },
    autoUpdateTime(value) {
      if (!value) return "Not yet";
      const date=new Date(value); return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString();
    },
    async saveAutoUpdate() {
      this.autoUpdate.busy=true; this.autoUpdate.message="Saving and validating the schedule…"; this.autoUpdate.messageKind="info";
      try {
        const r=await fetch("/api/auto-update/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(this.autoUpdate.draft)});
        const data=await r.json(); if(!r.ok) throw new Error(data.detail||`HTTP ${r.status}`);
        this.applyAutoUpdateStatus(data, true);
        this.autoUpdate.message=data.settings.mode==="off"?"Saved. Automatic updates are off and the schedule is unloaded.":"Saved. The updater schedule is installed and verified.";
        this.autoUpdate.messageKind="success";
      } catch(e) { this.autoUpdate.message=String(e.message||e); this.autoUpdate.messageKind="error"; }
      finally { this.autoUpdate.busy=false; }
    },
    async autoUpdateAction(action,body={}) {
      this.autoUpdate.busy=true; this.autoUpdate.message=action==="check"?"Checking safely…":"Starting the update helper…"; this.autoUpdate.messageKind="info";
      try {
        const r=await fetch(`/api/auto-update/${action}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
        const data=await r.json(); if(!r.ok) throw new Error(data.detail||`HTTP ${r.status}`);
        this.applyAutoUpdateStatus(data);
        this.autoUpdate.message=body.after_current?"Queued. The updater will retry when Music Studio is idle.":(action==="check"?"Check started. Status refreshes automatically.":"Update started. This page may reconnect during restart.");
        this.autoUpdate.messageKind="success";
      } catch(e) { this.autoUpdate.message=String(e.message||e); this.autoUpdate.messageKind="error"; }
      finally { this.autoUpdate.busy=false; }
    },

    async refreshMemoryPolicy(silent=false, forceDraft=false) {
      try {
        const r=await fetch("/api/memory-policy",{cache:"no-store"});
        const d=await r.json(); if(!r.ok) throw new Error(d.detail||`HTTP ${r.status}`);
        const saved=d.mode;
        Object.assign(this.memoryPolicy,d,{loaded:true});
        if(forceDraft || !this.memoryPolicy.dirty){this.memoryPolicy.draft={mode:saved};this.memoryPolicy.dirty=false;}
      } catch(e){if(!silent){this.memoryPolicy.message=String(e.message||e);this.memoryPolicy.messageKind="error";}}
    },
    markMemoryPolicyDirty(){this.memoryPolicy.dirty=true;this.memoryPolicy.message="";this.memoryPolicy.messageKind="info";},
    memoryPolicyTime(value){if(!value)return "Not scheduled";const n=Number(value);const d=new Date(n<1e12?n*1000:n);return Number.isNaN(d.getTime())?"Not scheduled":d.toLocaleString();},
    memoryModelLabel(){const p=this.memoryPolicy.loaded_model;return Array.isArray(p)&&p.length?String(p[0]).split("/").pop()+" · "+p[1]:"None loaded";},
    async saveMemoryPolicy(){
      this.memoryPolicy.busy=true;this.memoryPolicy.message="Saving memory mode…";this.memoryPolicy.messageKind="info";
      try{
        const r=await fetch("/api/memory-policy",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(this.memoryPolicy.draft)});
        const d=await r.json();if(!r.ok)throw new Error(d.detail||`HTTP ${r.status}`);
        Object.assign(this.memoryPolicy,d,{loaded:true,draft:{mode:d.mode},dirty:false,message:"Memory mode saved.",messageKind:"success"});
      }catch(e){this.memoryPolicy.message=String(e.message||e);this.memoryPolicy.messageKind="error";}
      finally{this.memoryPolicy.busy=false;}
    },
    async releaseMemory(){
      this.memoryPolicy.busy=true;this.memoryPolicy.message="Releasing local music memory…";this.memoryPolicy.messageKind="info";
      try{
        const r=await fetch("/api/memory/release",{method:"POST"});
        const d=await r.json();if(!r.ok)throw new Error(d.detail||`HTTP ${r.status}`);
        Object.assign(this.memoryPolicy,d,{loaded:true,message:d.last_release_details?.released?"Local music model unloaded and accelerator caches cleared.":"Allocator caches cleared; no local model was loaded.",messageKind:"success"});
        this.pushToast({kind:"success",icon:"✓",title:"Memory released",body:this.memoryPolicy.message});
      }catch(e){this.memoryPolicy.message=String(e.message||e);this.memoryPolicy.messageKind="error";this.pushToast({kind:"error",icon:"✗",title:"Couldn't release memory",body:this.memoryPolicy.message});}
      finally{this.memoryPolicy.busy=false;}
    },

    async refreshConnectivity() {
      try {
        const r = await fetch("/api/connectivity");
        const data = await r.json();
        Object.assign(this.conn, data);
      } catch { /* keep last */ }
    },

    async saveSettings() {
      const token = (this.settings.tokenInput || "").trim();
      if (!token) {
        this.settings.message = "Paste a token first (it should start with hf_…).";
        this.settings.messageKind = "error";
        return;
      }
      this.settings.busy = true;
      this.settings.message = "";
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hf_token: token }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || ("HTTP " + r.status));
        this.settings.hf_token_set = !!data.hf_token_set;
        this.settings.hf_token_masked = data.hf_token_masked || "";
        this.settings.tokenInput = "";       // clear the input after save
        this.settings.showToken = false;
        this.settings.message = `Saved. Future downloads will use this token automatically.`;
        this.settings.messageKind = "success";
        this.pushToast({ kind: "success", icon: "✓", title: "HF token saved",
          body: this.settings.hf_token_masked });
      } catch (e) {
        this.settings.message = String(e.message || e);
        this.settings.messageKind = "error";
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't save token",
          body: this.settings.message });
      } finally {
        this.settings.busy = false;
      }
    },

    async testToken() {
      // Test the input field if non-empty; otherwise test the saved token.
      const candidate = (this.settings.tokenInput || "").trim();
      this.settings.busy = true;
      this.settings.message = "Testing…";
      this.settings.messageKind = "info";
      try {
        const r = await fetch("/api/settings/test-hf-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(candidate ? { hf_token: candidate } : {}),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || ("HTTP " + r.status));
        const who = data.name || "your account";
        this.settings.message = `✓ Valid. Logged in as ${who}${data.type ? " (" + data.type + ")" : ""}.`;
        this.settings.messageKind = "success";
        this.pushToast({ kind: "success", icon: "✓", title: "Token valid",
          body: `Hi ${who}` });
      } catch (e) {
        this.settings.message = `✗ ${e.message || e}`;
        this.settings.messageKind = "error";
        this.pushToast({ kind: "error", icon: "✗", title: "Token invalid",
          body: this.settings.message });
      } finally {
        this.settings.busy = false;
      }
    },

    async clearToken() {
      if (!await this.askConfirm("Remove saved token?", "Downloads will fall back to anonymous mode — lower rate limits and no gated repos.", "Remove token")) return;
      this.settings.busy = true;
      this.settings.message = "";
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hf_token: "" }),
        });
        const data = await r.json();
        this.settings.hf_token_set = !!data.hf_token_set;
        this.settings.hf_token_masked = data.hf_token_masked || "";
        this.settings.message = "Token cleared.";
        this.settings.messageKind = "info";
        this.pushToast({ kind: "info", icon: "🧹", title: "HF token cleared" });
      } catch (e) {
        this.settings.message = String(e.message || e);
        this.settings.messageKind = "error";
      } finally {
        this.settings.busy = false;
      }
    },

    async clearFinishedDownloads() {
      try {
        const r = await fetch("/api/downloads", { method: "DELETE" });
        const data = await r.json().catch(() => ({}));
        // Stream will refresh the list on next tick; do an optimistic prune too
        // so the UI feels snappy.
        this.jobs = this.jobs.filter(j => !["done", "error", "cancelled"].includes(j.state));
        this.pushToast({ kind: "info", icon: "🧹", title: `Cleared ${data.cleared ?? 0} finished` });
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't clear downloads", body: String(e) });
      }
    },

    // ──────── imports flow ────────
    async scanImports() {
      try {
        const r = await fetch("/api/imports/scan");
        const data = await r.json();
        this.candidates = data.candidates || [];
      } catch { /* keep last */ }
    },

    async submitImport(mode = "link") {
      this.importMessage = "";
      this.importResult = null;
      if (mode === "move") {
        const sp = this.importForm.source_path || "(empty)";
        if (!await this.askConfirm(
          "Move into HF cache?",
          `${sp}\n\nThis physically relocates the folder — the source path will be gone afterwards.`,
          "Move"
        )) {
          return;
        }
      }
      try {
        const r = await fetch("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...this.importForm, mode }),
        });
        const data = await r.json();
        if (!r.ok) {
          this.importMessage = data.detail || "Import failed.";
          this.importMessageKind = "error";
          this.pushToast({ kind: "error", icon: "✗", title: "Import failed",
            body: data.detail || "(see network tab)" });
          return;
        }
        const verb = data.mode === "move" ? "Moved" : "Linked";
        this.importMessage = `${verb} ${data.repo}`;
        this.importMessageKind = "success";
        this.importResult = data;
        this.pushToast({
          kind: "success", icon: "✓",
          title: `${verb} ${data.repo}`,
          body: `→ ${data.target}`,
        });
        this.importForm = { source_path: "", repo: "" };
        await this.refreshCatalog();
      } catch (e) {
        this.importMessage = String(e);
        this.importMessageKind = "error";
        this.pushToast({ kind: "error", icon: "✗", title: "Import failed", body: String(e) });
      }
    },

    async linkCandidate(c) {
      this.importForm.source_path = c.source_path;
      this.importForm.repo = c.repo;
      await this.submitImport("link");
      await this.scanImports();
    },

    async moveCandidate(c) {
      this.importForm.source_path = c.source_path;
      this.importForm.repo = c.repo;
      await this.submitImport("move");
      await this.scanImports();
    },

    // ──────── generate flow ────────
    async refreshDiagnostics() {
      try {
        const r = await fetch("/api/generate/diagnostics");
        if (!r.ok) return;
        const data = await r.json();
        this.diag.device = data.device || null;
        this.diag.packages = data.packages || [];
        this.diag.engines = data.engines || [];
        this.diag.any_missing = !!data.any_missing;
        this.diag.ready_count = data.ready_count || 0;
        this.diag.total_engines = data.total_engines || 0;
        this.diag._lastFetched = Date.now();
      } catch { /* keep last */ }
    },

    async refreshGenAvailability() {
      try {
        const r = await fetch("/api/generate/availability");
        const data = await r.json();
        this.gen.available = !!data.available;
        this.gen.diffusers_available = !!data.diffusers_available;
        this.gen.error = data.error;
        this.gen.device = data.device;
        // For music the "presets" are duration shortcuts (5/10/15/30 sec) —
        // we don't auto-pick one; user chooses via the slider.
        this.gen.presets = data.duration_presets || [];
      } catch {
        this.gen.available = false;
      }
    },

    async refreshLoras() {
      try {
        const r = await fetch("/api/loras");
        const data = await r.json();
        this.loras = data.loras || [];
      } catch { /* keep last */ }
    },

    startGenStream() {
      if (this._genStreamHandle) this._genStreamHandle.close();
      const es = new EventSource("/api/generate/stream");
      es.addEventListener("snapshot", e => {
        try {
          const payload = JSON.parse(e.data);
          const incoming = (payload.jobs || []).slice().sort((a, b) => (b.started_at || 0) - (a.started_at || 0));

          // Detect state transitions running/queued → done/error/cancelled, fire a toast.
          for (const j of incoming) {
            const prev = this._jobStatePrev[j.id];
            const terminal = ["done", "error", "cancelled"];
            if (prev && prev !== j.state && terminal.includes(j.state) && !terminal.includes(prev)) {
              this._notifyJobFinished(j);
            }
            this._jobStatePrev[j.id] = j.state;
          }

          this.gen.jobs = incoming;
          // Keep the currentJob reference fresh so progress updates flow.
          if (this.gen.currentJob) {
            const updated = this.gen.jobs.find(j => j.id === this.gen.currentJob.id);
            if (updated) this.gen.currentJob = updated;
          }
          // If we have no current job but there's a running/done one, surface it.
          if (!this.gen.currentJob && this.gen.jobs.length) {
            this.gen.currentJob = this.gen.jobs[0];
          }
          // Manage the busy flag.
          const running = this.gen.jobs.find(j => j.state === "running" || j.state === "queued");
          this.gen.busy = !!running;
          if (running) {
            // Use the real fields the job actually has: `progress` (0..1) and
            // `started_at`. The old label read current_step/total_steps, which
            // don't exist on the job → "Generating… undefined/undefined".
            const pct = Math.round((running.progress || 0) * 100);
            const elapsed = running.started_at
              ? Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(running.started_at)) : 0;
            this.gen.busyLabel = "Generating…"
              + (pct > 0 ? ` ${pct}%` : "")
              + (elapsed ? ` · ${elapsed}s` : "");
          }
        } catch { /* swallow */ }
      });
      es.onerror = () => { /* auto-reconnects */ };
      this._genStreamHandle = es;
    },

    _notifyJobFinished(job) {
      if (job.state === "done") {
        this.pushToast({
          kind: "success",
          icon: "✓",
          title: "Generation done",
          body: this.formatDuration(job.duration_seconds) + (job.params?.prompt ? ` · "${job.params.prompt.slice(0, 50)}"` : ""),
        });
        this._tryNativeNotification("MusicStudio · done", job.params?.prompt?.slice(0, 80) || "");
        this._flashTabTitle("✓ Done");
        if (this.gen.autoPlay && job.output_url) {
          try { new Audio(job.output_url).play().catch(() => {}); } catch { /* ignore */ }
        }
        this.refreshOutputStats();               // a new file landed — refresh the disk figure
      } else if (job.state === "error") {
        this.pushToast({
          kind: "error",
          icon: "✗",
          title: "Generation error",
          body: job.error || "(see server terminal)",
        });
        this._tryNativeNotification("MusicStudio · error", job.error || "");
        this._flashTabTitle("✗ Error");
      } else if (job.state === "cancelled") {
        this.pushToast({ kind: "warn", icon: "⏹", title: "Generation cancelled" });
      }
    },

    pickAspect(p) {
      this.gen.aspect = p.ratio;
      this.gen.width = p.width;
      this.gen.height = p.height;
    },

    aspectShape(p) {
      // Build a small rectangle whose proportions reflect the aspect ratio,
      // capped to a tile-sized box so the grid stays orderly.
      const max = 28;
      const ratio = p.width / p.height;
      const w = ratio >= 1 ? max : Math.round(max * ratio);
      const h = ratio >= 1 ? Math.round(max / ratio) : max;
      return `width:${w}px;height:${h}px;`;
    },

    magicPrompt() {
      // Lightweight no-LLM enhancer: appends quality + style tags if not present.
      const tags = "masterpiece, best quality, highly detailed, sharp focus, cinematic lighting";
      const existing = this.gen.prompt.trim();
      if (!existing) return;
      if (existing.toLowerCase().includes("masterpiece")) return;
      this.gen.prompt = existing + (existing.endsWith(",") ? " " : ", ") + tags;
    },

    randomPrompt() {
      const pool = window.SAMPLE_PROMPTS || [];
      if (pool.length === 0) {
        alert("No sample prompts loaded.");
        return;
      }
      // Pick uniformly at random, but never the same as the previous pick.
      let idx;
      if (pool.length === 1) {
        idx = 0;
      } else {
        do { idx = Math.floor(Math.random() * pool.length); }
        while (idx === this._lastRandomPromptIndex);
      }
      this._lastRandomPromptIndex = idx;
      this.gen.prompt = pool[idx];
    },

    toggleLora(name, on) {
      if (on) {
        if (!this.gen.loraNames.includes(name)) this.gen.loraNames.push(name);
        if (this.gen.loraWeights[name] === undefined) this.gen.loraWeights[name] = 1.0;
      } else {
        this.gen.loraNames = this.gen.loraNames.filter(n => n !== name);
        delete this.gen.loraWeights[name];
      }
    },

    // ──────── input image helpers (img2img) ────────
    setInputImage(blobOrFile, name) {
      // Clear any previous object URL so we don't leak memory.
      if (this.gen.inputImageUrl) {
        try { URL.revokeObjectURL(this.gen.inputImageUrl); } catch {}
      }
      this.gen.inputImageFile = blobOrFile;
      this.gen.inputImageUrl = URL.createObjectURL(blobOrFile);
      this.gen.inputImageName = name || blobOrFile.name || "image";
      // If we're not already in img2img mode, switch — the user clearly wants it.
      if (this.gen.mode !== "img2img") this.gen.mode = "img2img";
    },

    clearInputImage() {
      if (this.gen.inputImageUrl) {
        try { URL.revokeObjectURL(this.gen.inputImageUrl); } catch {}
      }
      this.gen.inputImageFile = null;
      this.gen.inputImageUrl = "";
      this.gen.inputImageName = "";
    },

    handleImageDrop(e) {
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) {
        this.setInputImage(file, file.name);
      } else {
        this.pushToast({ kind: "warn", icon: "⚠", title: "Not an image",
          body: "Drop a PNG, JPG, or WEBP file." });
      }
    },

    handleImageFileInput(e) {
      const file = e.target.files?.[0];
      if (file) this.setInputImage(file, file.name);
      e.target.value = "";   // reset so picking the same file twice fires change
    },

    async submitGenerate() {
      if (!this.gen.available) {
        this.pushToast({ kind: "warn", icon: "⚠", title: "Engine not installed",
          body: "Click Install Generation in the Pinokio sidebar." });
        return;
      }
      if (!this.selectedModel) {
        this.pushToast({ kind: "warn", icon: "⚠", title: "Pick a cached model first",
          body: "Open the Models tab and download one." });
        return;
      }
      if (!this.gen.prompt.trim()) return;

      const count = Math.max(1, Math.min(8, this.gen.batchCount | 0));
      const baseSeed = this.gen.seed;
      const usingRandomSeed = baseSeed == null || baseSeed < 0;

      this._requestNotificationPermission();
      // Transient lock — prevents double-click while the POST is in flight.
      this.gen.submitting = true;

      let lastJob = null;
      for (let i = 0; i < count; i++) {
        const seedForThis = usingRandomSeed ? -1 : (baseSeed + i);
        try {
          const body = {
            repo: this.gen.repo,
            prompt: this.gen.prompt.trim(),
            negative_prompt: this.gen.negativePrompt.trim(),
            duration: Number(this.gen.duration),
            guidance: Number(this.gen.guidance),
            temperature: Number(this.gen.temperature),
            steps: Number(this.gen.steps),
            seed: seedForThis,
            chain_count: Math.max(1, Math.min(8, this.gen.chainCount | 0)),
            crossfade_seconds: Math.max(0, Number(this.gen.crossfadeSeconds) || 0),
          };
          const r = await fetch("/api/generate/txt2music", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            this.pushToast({ kind: "error", icon: "✗", title: "Submit failed",
              body: err.detail || ("HTTP " + r.status) });
            break;
          }
          const { job } = await r.json();
          lastJob = job;
        } catch (e) {
          this.pushToast({ kind: "error", icon: "✗", title: "Submit failed",
            body: String(e) });
          break;
        }
      }
      if (lastJob) {
        this.gen.currentJob = lastJob;
        this.gen.busy = true;
        if (count > 1) {
          this.pushToast({ kind: "info", icon: "▶", title: `Queued ${count} clips`,
            body: "They'll generate one after another. Cancel any from the queue panel." });
        }
      }
      // Tail timer — re-enables the button so user can queue another.
      setTimeout(() => { this.gen.submitting = false; }, 300);
    },

    async copyAudioUrl(job) {
      if (!job?.output_url) return;
      const full = window.location.origin + job.output_url;
      await this.copyText(full);
    },

    async cancelGenerate(jobId) {
      try {
        await fetch("/api/generate/jobs/" + encodeURIComponent(jobId), { method: "DELETE" });
      } catch { /* surfaces via stream */ }
    },

    async clearHistory() {
      // Two-click confirm instead of native confirm() — Pinokio's embedded webview
      // can silently block window.confirm() (it returns false), making this button
      // appear to do nothing. First click arms; a second click within 3s clears.
      if (!this.gen.clearArmed) {
        this.gen.clearArmed = true;
        clearTimeout(this._clearArmTimer);
        this._clearArmTimer = setTimeout(() => { this.gen.clearArmed = false; }, 3000);
        return;
      }
      clearTimeout(this._clearArmTimer);
      this.gen.clearArmed = false;
      try {
        const r = await fetch("/api/generate/jobs", { method: "DELETE" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        this.gen.currentJob = null;
        this.gen.jobs = (this.gen.jobs || []).filter(j => ["queued", "running", "cancelling"].includes(j.state));
        this._jobStatePrev = {};
        this.pushToast({ kind: "info", icon: "🧹", title: "History cleared", body: "The audio files stay in your outputs folder." });
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't clear history", body: String(e) });
      }
    },

    /** Open the outputs folder (where every generated file lands) in Finder.
     *  Derived from any output's absolute path — needs no extra endpoint. */
    openOutputsFolder() {
      const withPath = (this.gen.jobs || []).find(j => j.output_path);
      if (withPath && withPath.output_path) {
        this.revealInFolder(withPath.output_path.replace(/[/\\][^/\\]+$/, ""));
      } else {
        this.pushToast({ kind: "info", icon: "📂", title: "No generations yet",
          body: "Generate something first — then this opens the folder with all your audio files." });
      }
    },

    /** Delete one finished generation (removes it from history AND deletes the
     *  audio file). Two-click confirm — first click arms this row, second deletes. */
    deleteGeneration(job) {
      if (this.gen.deleteArmed !== job.id) {
        this.gen.deleteArmed = job.id;
        clearTimeout(this._deleteArmTimer);
        this._deleteArmTimer = setTimeout(() => { this.gen.deleteArmed = null; }, 3000);
        return;
      }
      clearTimeout(this._deleteArmTimer);
      this.gen.deleteArmed = null;
      this._doDeleteGeneration(job);
    },
    async _doDeleteGeneration(job) {
      try {
        const r = await fetch("/api/generate/history/" + encodeURIComponent(job.id), { method: "DELETE" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        this.gen.jobs = (this.gen.jobs || []).filter(j => j.id !== job.id);
        if (this.gen.currentJob && this.gen.currentJob.id === job.id) this.gen.currentJob = null;
        this.refreshOutputStats();
        this.pushToast({ kind: "info", icon: "🗑", title: "Generation deleted" });
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't delete",
          body: "This needs the latest backend — run Update once from the Pinokio sidebar." });
      }
    },

    // ──────── outputs folder disk usage ────────
    outputStats: { bytes: 0, count: 0, loaded: false },
    storagePolicy: { enabled: true, retention_days: 30, max_gb: 80, used_bytes: 0, over_limit: false, loaded: false, busy: false, message: "" },
    get outputSizeLabel() {
      return humanBytes(this.outputStats.bytes || 0);
    },
    async refreshOutputStats() {
      try {
        const r = await fetch("/api/output/stats");
        if (!r.ok) return;                         // endpoint not live until next Update
        const d = await r.json();
        this.outputStats = { bytes: d.bytes || 0, count: d.count || 0, loaded: true };
      } catch { /* keep last */ }
    },
    async refreshStoragePolicy() {
      try {
        const r = await fetch("/api/storage-policy");
        if (!r.ok) return;
        this.storagePolicy = { ...this.storagePolicy, ...(await r.json()), loaded: true, busy: false };
      } catch { /* keep last */ }
    },
    async saveStoragePolicy() {
      this.storagePolicy.busy = true;
      this.storagePolicy.message = "Saving policy…";
      try {
        const r = await fetch("/api/storage-policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !!this.storagePolicy.enabled, retention_days: Number(this.storagePolicy.retention_days), max_gb: Number(this.storagePolicy.max_gb) }) });
        if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
        const d = await r.json();
        this.storagePolicy = { ...this.storagePolicy, ...d, loaded: true, busy: false, message: "Saved. This Mac will enforce the policy automatically." };
        this.pushToast({ kind: "info", icon: "✓", title: "Storage policy saved", body: `${d.retention_days} days · ${d.max_gb} GB hard cap` });
      } catch (e) {
        this.storagePolicy.busy = false; this.storagePolicy.message = String(e);
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't save storage policy", body: String(e) });
      }
    },
    async cleanStoragePolicyNow() {
      this.storagePolicy.busy = true;
      this.storagePolicy.message = "Checking completed outputs…";
      try {
        const r = await fetch("/api/storage-policy/cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (!r.ok) throw new Error((await r.json()).detail || `HTTP ${r.status}`);
        const d = await r.json();
        this.storagePolicy = { ...this.storagePolicy, ...d, loaded: true, busy: false, message: `Cleanup complete · ${d.deleted || 0} removed · ${humanBytes(d.freed_bytes || 0)} freed.` };
        await this.refreshOutputStats();
        this.pushToast({ kind: "info", icon: "🧹", title: "Cleanup complete", body: `${d.deleted || 0} file${d.deleted === 1 ? "" : "s"} removed · ${humanBytes(d.freed_bytes || 0)} freed` });
      } catch (e) {
        this.storagePolicy.busy = false; this.storagePolicy.message = String(e);
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't clean outputs", body: String(e) });
      }
    },
    /** mode: "keep50" keeps the newest 50; "old30" deletes files older than 30 days. */
    async pruneOutputs(mode) {
      const body = mode === "old30" ? { older_than_days: 30 } : { keep_last: 50 };
      if (this.gen.pruneArmed !== mode) {
        this.gen.pruneArmed = mode;
        clearTimeout(this._pruneArmTimer);
        this._pruneArmTimer = setTimeout(() => { this.gen.pruneArmed = null; }, 3000);
        return;
      }
      clearTimeout(this._pruneArmTimer);
      this.gen.pruneArmed = null;
      try {
        const r = await fetch("/api/output/prune", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        await this.refreshOutputStats();
        this.pushToast({ kind: "info", icon: "🧹", title: "Outputs pruned",
          body: `Deleted ${d.deleted} file${d.deleted === 1 ? "" : "s"} (${humanBytes(d.freed_bytes || 0)}) — kept ${mode === "old30" ? "recent" : "the newest 50"}.` });
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't prune",
          body: "This needs the latest backend — run Update once from the Pinokio sidebar." });
      }
    },

    // ──────── in-app confirm (webview-safe) ────────
    // Native window.confirm() is silently blocked by Pinokio's embedded webview
    // (returns false), so destructive actions using it appeared to do nothing.
    // askConfirm() opens an in-app modal and resolves true/false when the user
    // chooses. Usage: `if (!await this.askConfirm("Title", "body")) return;`
    askConfirm(title, body, confirmLabel = "Confirm") {
      return new Promise((resolve) => {
        this.confirmDialog = { title, body, confirmLabel, resolve };
      });
    },
    _resolveConfirm(value) {
      if (this.confirmDialog) {
        const r = this.confirmDialog.resolve;
        this.confirmDialog = null;
        r(value);
      }
    },

    // ──────── toasts / native notification / tab title ────────

    pushToast(t) {
      const id = ++this._toastSeq;
      this.toasts.push({ id, ...t });
      const ttl = t.kind === "error" ? 8000 : 4500;
      setTimeout(() => this.dismissToast(id), ttl);
    },

    dismissToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    },

    _requestNotificationPermission() {
      // Only ask once per session. User must accept once; thereafter it's
      // remembered by the browser. Failing silently is fine.
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") {
        try { Notification.requestPermission(); } catch { /* ignore */ }
      }
    },

    _tryNativeNotification(title, body) {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      // Don't pop a notification if the page is currently visible — toasts cover that case.
      if (document.visibilityState === "visible") return;
      try {
        const n = new Notification(title, { body, silent: false });
        setTimeout(() => n.close(), 6000);
      } catch { /* some browsers/contexts restrict this; ignore */ }
    },

    _flashTabTitle(label) {
      // Briefly mutate document.title to grab attention in a background tab,
      // then restore the original after 6s OR on tab focus.
      const original = "MusicStudio (Mac)";
      document.title = `${label} · ${original}`;
      const restore = () => {
        document.title = original;
        document.removeEventListener("visibilitychange", restore);
      };
      document.addEventListener("visibilitychange", restore);
      setTimeout(restore, 6000);
    },

    genStateChipClass(state) {
      if (!state) return "";
      if (state === "done") return "ok";
      if (state === "error") return "bad";
      if (["cancelled", "cancelling"].includes(state)) return "warn";
      return "";
    },

    genProgressLabel() {
      const j = this.gen.currentJob;
      if (!j) return "";
      if (j.total_steps > 0) return `step ${j.current_step} / ${j.total_steps}`;
      return "warming up…";
    },

    elapsedFor(job) {
      // Backend computes duration_seconds when finished; for running jobs we
      // tick locally so the display updates without depending on the SSE cadence.
      if (!job || !job.started_at) return 0;
      if (job.state === "running" || job.state === "queued") {
        return Math.max(0, this._nowSec - job.started_at);
      }
      return job.duration_seconds ?? 0;
    },

    formatDuration(sec) {
      if (sec == null || isNaN(sec)) return "—";
      sec = Math.round(sec);
      if (sec < 60) return `${sec}s`;
      if (sec < 3600) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s.toString().padStart(2, "0")}s`;
      }
      // Download ETAs on a slow/throttled connection can legitimately reach
      // hour/day scale — "734m 12s" is as unreadable as the settle-guard bug.
      if (sec < 86400) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${m.toString().padStart(2, "0")}m`;
      }
      const d = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      return `${d}d ${h.toString().padStart(2, "0")}h`;
    },

    downloadFilename(job) {
      if (!job) return "music.wav";
      const prompt = (job.params?.prompt || "music")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "music";
      const seed = job.resolved_seed ?? "seed";
      return `${prompt}-${seed}-${job.id}.wav`;
    },

    reuseParams(job) {
      const p = job?.params;
      if (!p) return;
      this.tab = "generate";
      if (p.repo) {
        const stillCached = this.cachedModels.some(m => m.repo === p.repo);
        if (stillCached) {
          this.gen.repo = p.repo;
          this._repoUserConfirmed = true;
        }
      }
      this.gen.prompt = p.prompt || "";
      this.gen.negativePrompt = p.negative_prompt || "";
      if (typeof p.duration === "number")    this.gen.duration = p.duration;
      if (typeof p.steps === "number")       this.gen.steps = p.steps;
      if (typeof p.guidance === "number")    this.gen.guidance = p.guidance;
      if (typeof p.temperature === "number") this.gen.temperature = p.temperature;
      if (typeof p.chain_count === "number")       this.gen.chainCount = p.chain_count;
      if (typeof p.crossfade_seconds === "number") this.gen.crossfadeSeconds = p.crossfade_seconds;
      const reuseSeed = job.resolved_seed ?? p.seed;
      if (typeof reuseSeed === "number") this.gen.seed = reuseSeed;
      this.gen.loraNames   = [...(p.lora_names || [])];
      this.gen.loraWeights = {};
      (p.lora_names || []).forEach((n, i) => {
        this.gen.loraWeights[n] = p.lora_scales?.[i] ?? 1.0;
      });
    },

    async copyImageUrl(job) {
      if (!job?.output_url) return;
      const full = window.location.origin + job.output_url;
      await this.copyText(full);
    },

    async revealInFolder(path) {
      if (!path) return;
      try {
        const r = await fetch("/api/reveal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          this.pushToast({ kind: "error", icon: "✗", title: "Couldn't open in Finder",
            body: err.detail || ("HTTP " + r.status) });
        }
      } catch (e) {
        this.pushToast({ kind: "error", icon: "✗", title: "Couldn't open in Finder", body: String(e) });
      }
    },

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback for non-secure contexts
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch {}
        ta.remove();
      }
    },

    recentTileTitle(j) {
      if (!j) return "";
      const prompt = j.params?.prompt ? `"${j.params.prompt.slice(0, 60)}"` : "(no prompt)";
      const dur = j.duration_seconds != null ? this.formatDuration(j.duration_seconds) : j.state;
      const seed = j.resolved_seed != null ? ` · seed ${j.resolved_seed}` : "";
      return `${prompt} · ${dur}${seed}`;
    },

    // ──────── formatters ────────
    formatGb(gb) {
      // Decimal MB/GB (÷1000) to match the catalog's `size_gb` convention and
      // humanBytes() below. Previously used ×1024 which quietly turned a
      // catalog value of 0.5 GB into "512 MB" instead of "500 MB".
      if (gb < 1) return Math.round(gb * 1000) + " MB";
      return gb.toFixed(1) + " GB";
    },

    formatClipDuration(seconds) {
      const value = Number(seconds) || 0;
      if (value >= 60 && value % 60 === 0) return (value / 60) + " min";
      return value + " sec";
    },

    cardClass(m) {
      return m.cache.state;
    },

    /** Short label for the hardware-fit chip on a model card. Mirrors the
     *  backend's `fit.state` enum: ok / tight / risky / unknown. */
    fitChipLabel(fit) {
      if (!fit) return "";
      const map = {
        ok:      "✓ fits",
        tight:   "⚠ tight",
        risky:   "✗ may not fit",
        unknown: "? fit unknown",
      };
      return map[fit.state] || "";
    },

    /** Bullet glyph for each use_case kind. */
    useCaseIcon(kind) {
      const map = { good: "✅", weak: "⚠️", avoid: "❌" };
      return map[kind] || "•";
    },

    cacheChipLabel(state) {
      return { cached: "cached", partial: "partial", absent: "not downloaded" }[state] || state;
    },

    cacheChipClass(state) {
      return { cached: "ok", partial: "warn", absent: "" }[state] || "";
    },

    chipExplain(state) {
      return {
        cached:  "All files for this model are on disk and ready to generate from.",
        partial: "Some files have downloaded; the model isn't usable yet. Clicking Download resumes from where it left off.",
        absent:  "No files for this model on disk. Click Download to fetch them.",
      }[state] || "";
    },

    capabilityLabel(c) {
      return {
        "text-to-music": "Music",
        "sound-effects": "Sound effects",
        vocal: "Vocals",
        stereo: "Stereo",
      }[c] || c;
    },

    capabilityHint(c) {
      return {
        "text-to-music": "Generate music from a text prompt.",
        "sound-effects": "Generate ambience, foley, and non-musical audio.",
        vocal: "Supports singing or vocal-style output.",
        stereo: "Produces stereo rather than mono audio.",
      }[c] || "";
    },

    stateChipClass(state) {
      if (state === "done") return "ok";
      if (state === "error") return "bad";
      if (state === "cancelled" || state === "cancelling") return "warn";
      return "";
    },

    downloadCaption(j) {
      const done = humanBytes(j.bytes_observed || 0);
      let line = done;
      if (j.bytes_total > 0) {
        const total = humanBytes(j.bytes_total);
        const pct = j.percent != null ? j.percent.toFixed(1) + "%" : "";
        line = `${done} / ${total}  ${pct}`;
      }
      // Surface the live byte-rate so users can tell at a glance whether the
      // download is actually progressing vs. wedged.
      if (j.state === "running" && j.speed_bps > 0) {
        line += ` · ${humanBytes(j.speed_bps)}/s`;
        if (j.eta_seconds != null && isFinite(j.eta_seconds)) {
          line += ` · ETA ${this.formatDuration(j.eta_seconds)}`;
        }
      } else if (j.state === "running") {
        // No measured speed yet (just started). Still tell the user it's alive.
        line += " · measuring…";
      }
      return line;
    },
  };
}

function humanBytes(n) {
  // Decimal units (÷1000, "KB/MB/GB/TB") — matches how HuggingFace reports repo
  // sizes and how the catalog's `size_gb` is populated. Using binary (÷1024)
  // with the same labels caused a visible split-brain: a model the Models tab
  // labels "2.3 GB" would show "2.14 GB / 2.14 GB" during download because the
  // catalog stored decimal-GB while the download progress used binary math.
  // If we ever need actual binary display, switch the labels to "KiB/MiB/GiB"
  // — never mix conventions with the same label.
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return n.toFixed(n < 10 ? 2 : 1) + " " + units[i];
}

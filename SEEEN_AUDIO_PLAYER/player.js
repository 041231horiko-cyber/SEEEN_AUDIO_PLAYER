(function () {
  "use strict";

  var SWITCH_CLICK_ENABLED = true;
  var COUNT_IN_BPM = 160;
  // The WAV contains two beats over 0.75 seconds at its native speed.
  var cueDurationSeconds = 0.75;
  var cueSource = "audio/ui-switch.wav";
  var cueOperation = 0;

  var TRACKS = {
    "bright-wide": {
      label: "BRIGHT / WIDE",
      src: "audio/bright_wide_loop.wav"
    },
    "bright-narrow": {
      label: "BRIGHT / NARROW",
      src: "audio/bright_narrow_loop.wav"
    },
    "dark-wide": {
      label: "DARK / WIDE",
      src: "audio/dark_wide_loop.wav"
    },
    "dark-narrow": {
      label: "DARK / NARROW",
      src: "audio/dark_narrow_loop.wav"
    }
  };

  var audio = document.getElementById("audio-player");
  var playToggle = document.getElementById("play-toggle");
  var nowPlaying = document.getElementById("now-playing");
  var playbackState = document.getElementById("playback-state");
  var offlineStatus = document.getElementById("offline-status");
  var errorMessage = document.getElementById("error-message");
  var instruction = document.getElementById("instruction");
  var announcement = document.getElementById("live-announcement");
  var trackButtons = Array.prototype.slice.call(document.querySelectorAll("[data-track]"));

  var currentTrackKey = null;
  var operationId = 0;
  var switchingOperation = 0;
  var serviceWorkerRegistration = null;

  function setPlaybackState(state, label) {
    playbackState.value = label || state.toUpperCase();
    playbackState.textContent = label || state.toUpperCase();
    playbackState.dataset.state = state;

    var isPlaying = state === "playing" || state === "counting";
    playToggle.textContent = isPlaying ? "PAUSE" : "PLAY";
    playToggle.setAttribute("aria-label", isPlaying ? "一時停止する" : "再生する");
    playToggle.dataset.playing = isPlaying ? "true" : "false";
  }

  function setSelectedTrack(key) {
    currentTrackKey = key;
    var track = TRACKS[key];
    nowPlaying.value = track.label;
    nowPlaying.textContent = track.label;
    instruction.textContent = "TAP ANOTHER FIELD TO SWITCH";

    trackButtons.forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.track === key ? "true" : "false");
    });
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  function describePlayError(error) {
    if (error && error.name === "NotAllowedError") {
      return "再生が許可されませんでした。音源ボタンをもう一度タップしてください。";
    }
    if (error && error.name === "NotSupportedError") {
      return "音源形式を再生できません。音源ファイルを確認してください。";
    }
    return "再生を開始できませんでした。音源またはオフライン保存状態を確認してください。";
  }

  function expectedSourceUrl() {
    if (!currentTrackKey) {
      return "";
    }
    return new URL(TRACKS[currentTrackKey].src, document.baseURI).href;
  }

  function isExpectedSource() {
    return Boolean(audio.currentSrc) && audio.currentSrc === expectedSourceUrl();
  }

  async function selectTrack(key, skipCue) {
    var track = TRACKS[key];
    if (!track) {
      return;
    }

    var thisOperation = ++operationId;
    var useCue = SWITCH_CLICK_ENABLED && !skipCue && currentTrackKey && currentTrackKey !== key;
    cueOperation = useCue ? thisOperation : 0;
    switchingOperation = thisOperation;
    clearError();
    setSelectedTrack(key);
    setPlaybackState(useCue ? "counting" : "loading", useCue ? "COUNT IN" : "LOADING");
    if (!skipCue) document.dispatchEvent(new Event("fieldselection"));

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.src = useCue ? cueSource : track.src;
    audio.defaultPlaybackRate = useCue ? cueDurationSeconds * COUNT_IN_BPM / (2 * 60) : 1;
    audio.loop = !useCue;
    audio.load();

    try {
      audio.playbackRate = audio.defaultPlaybackRate;
      audio.currentTime = 0;
    } catch (error) {
      // Safari may reject seeking until metadata is available. A new source starts at zero.
    }

    try {
      var playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }

      if (operationId !== thisOperation) {
        return;
      }

      if (useCue) return;
      setPlaybackState("playing", "PLAYING");
      announcement.textContent = track.label + " を再生中";
    } catch (error) {
      if (operationId !== thisOperation) {
        return;
      }

      if (error && error.name === "AbortError") {
        setPlaybackState("paused", "INTERRUPTED");
        showError("再生開始が中断されました。音源ボタンをもう一度タップしてください。");
        return;
      }

      setPlaybackState("error", "ERROR");
      showError(describePlayError(error));
    } finally {
      if (switchingOperation === thisOperation) {
        switchingOperation = 0;
      }
    }
  }

  async function togglePlayback() {
    if (!currentTrackKey) {
      await selectTrack("bright-wide");
      return;
    }

    if (cueOperation) {
      if (playbackState.dataset.state === "counting") {
        operationId++;
        audio.pause();
        setPlaybackState("paused", "PAUSED");
      } else {
        await selectTrack(currentTrackKey, true);
      }
      return;
    }

    if (!audio.paused) {
      operationId += 1;
      switchingOperation = 0;
      audio.pause();
      setPlaybackState("paused", "PAUSED");
      announcement.textContent = "一時停止";
      return;
    }

    var thisOperation = ++operationId;
    clearError();
    setPlaybackState("loading", "LOADING");

    try {
      var playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }

      if (operationId !== thisOperation) {
        return;
      }

      setPlaybackState("playing", "PLAYING");
      announcement.textContent = "再生を再開";
    } catch (error) {
      if (operationId !== thisOperation) {
        return;
      }

      if (error && error.name === "AbortError") {
        setPlaybackState("paused", "INTERRUPTED");
        showError("再生再開が中断されました。PLAY をもう一度タップしてください。");
        return;
      }

      setPlaybackState("error", "ERROR");
      showError(describePlayError(error));
    }
  }

  function mediaErrorMessage() {
    if (!audio.error) {
      return "音源を読み込めませんでした。";
    }

    var messages = {
      1: "音源の読み込みが中断されました。",
      2: "通信またはキャッシュの問題で音源を読み込めません。",
      3: "音源をデコードできません。ファイルを確認してください。",
      4: "この音源形式は再生できません。"
    };
    return messages[audio.error.code] || "音源を読み込めませんでした。";
  }

  function setOfflineState(state, label, retryable) {
    var scope = serviceWorkerRegistration && serviceWorkerRegistration.scope;
    console.info("[SEEEN offline]", {status: label, url: location.href, secure: window.isSecureContext,
      supported: "serviceWorker" in navigator, scope: scope, inScope: !!scope && location.href.startsWith(scope),
      controller: navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL});
    offlineStatus.textContent = label;
    offlineStatus.dataset.state = state;
    offlineStatus.disabled = !retryable;
    offlineStatus.setAttribute("aria-label", retryable ? "オフライン保存を再試行" : "オフライン状態 " + label);
  }

  function sendServiceWorkerMessage(type) {
    return new Promise(function (resolve, reject) {
      if (!serviceWorkerRegistration) {
        reject(new Error("Service Worker is not ready"));
        return;
      }

      var worker = navigator.serviceWorker.controller || serviceWorkerRegistration.active || serviceWorkerRegistration.waiting || serviceWorkerRegistration.installing;
      if (!worker) {
        reject(new Error("Service Worker is not active"));
        return;
      }

      var channel = new MessageChannel();
      var timeout = window.setTimeout(function () {
        reject(new Error("Service Worker response timed out"));
      }, 30000);

      channel.port1.onmessage = function (event) {
        window.clearTimeout(timeout);
        console.info("[SEEEN offline] " + type, event.data);
        resolve(event.data);
      };

      worker.postMessage({ type: type }, [channel.port2]);
    });
  }

  async function checkOfflineStatus() {
    setOfflineState("checking", "CHECKING", false);
    try {
      var result = await sendServiceWorkerMessage("CHECK_OFFLINE_STATUS");
      if (result && result.ready && result.switchCueCached === true) {
        setOfflineState("ready", "READY", false);
        return true;
      }

      var missingCount = result && result.missing ? result.missing.length : 4;
      setOfflineState("incomplete", "RETRY", true);
      showError("オフライン保存が未完了です（不足 " + missingCount + "件）。通信を確認して RETRY をタップしてください。");
      return false;
    } catch (error) {
      setOfflineState("incomplete", "RETRY", true);
      showError("オフライン保存状態を確認できません。通信を確認して RETRY をタップしてください。");
      return false;
    }
  }

  async function repairOfflineCache() {
    setOfflineState("checking", "SAVING", false);
    clearError();

    try {
      var result = await sendServiceWorkerMessage("CACHE_ALL_ASSETS");
      if (!result || !result.ready || !result.switchCueCached) {
        throw new Error("Cache incomplete");
      }
      setOfflineState("ready", "READY", false);
      announcement.textContent = "オフライン保存が完了";
    } catch (error) {
      setOfflineState("incomplete", "RETRY", true);
      showError("オフライン保存に失敗しました。オンライン接続と空き容量を確認してください。");
    }
  }

  async function registerServiceWorker() {
    if (!window.isSecureContext || location.protocol === "file:" || !("serviceWorker" in navigator)) {
      setOfflineState("error", "UNAVAILABLE", false);
      showError("このブラウザではオフライン機能を利用できません。HTTPS または localhost で開いてください。");
      return;
    }

    setOfflineState("checking", "CHECKING", false);

    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      if (!serviceWorkerRegistration.active) {
        var installing = serviceWorkerRegistration.installing || serviceWorkerRegistration.waiting;
        if (!installing) throw new Error("No worker available");
        await new Promise(function (resolve, reject) {
          function changed() {
            if (installing.state === "activated" || installing.state === "redundant") {
              installing.removeEventListener("statechange", changed);
              if (installing.state === "activated") resolve();
              else reject(new Error("Installation failed"));
            }
          }
          installing.addEventListener("statechange", changed);
          changed();
        });
      }
      await checkOfflineStatus();
    } catch (error) {
      console.warn("[SEEEN offline] registration", error);
      if (navigator.serviceWorker.controller) {
        serviceWorkerRegistration = await navigator.serviceWorker.getRegistration();
        await checkOfflineStatus();
      } else {
        setOfflineState("incomplete", "RETRY", true);
        showError("保存を開始できません。オンラインで RETRY をタップしてください。");
      }
    }
  }

  trackButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectTrack(button.dataset.track);
    });
  });

  playToggle.addEventListener("click", togglePlayback);
  offlineStatus.addEventListener("click", function () {
    if (serviceWorkerRegistration && serviceWorkerRegistration.active) repairOfflineCache();
    else registerServiceWorker();
  });
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (serviceWorkerRegistration) checkOfflineStatus();
    });
  }

  audio.addEventListener("play", function () {
    if (!switchingOperation && isExpectedSource()) {
      setPlaybackState("playing", "PLAYING");
    }
  });

  audio.addEventListener("pause", function () {
    if (audio.paused && !switchingOperation && currentTrackKey && !audio.ended && playbackState.dataset.state === "playing") {
      setPlaybackState("paused", "PAUSED");
    }
  });

  audio.addEventListener("waiting", function () {
    if (isExpectedSource()) {
      setPlaybackState("loading", "BUFFERING");
    }
  });

  audio.addEventListener("stalled", function () {
    if (isExpectedSource()) {
      setPlaybackState("loading", "STALLED");
    }
  });

  audio.addEventListener("playing", function () {
    if (isExpectedSource()) {
      setPlaybackState("playing", "PLAYING");
      clearError();
    }
  });

  audio.addEventListener("error", function () {
    if (!audio.error || (!cueOperation && !isExpectedSource())) {
      return;
    }
    setPlaybackState("error", "ERROR");
    showError(mediaErrorMessage() + " OFFLINE 状態も確認してください。");
  });

  audio.addEventListener("ended", function () {
    if (!audio.ended || !currentTrackKey) return;
    if (cueOperation === operationId && audio.currentSrc === new URL(cueSource, document.baseURI).href) {
      selectTrack(currentTrackKey, true);
      return;
    }
    if (!isExpectedSource()) return;
    var endedOperation = operationId;
    audio.currentTime = 0;
    audio.play().catch(function () {
      if (operationId !== endedOperation) return;
      setPlaybackState("error", "ERROR");
      showError("ループ再開に失敗しました。音源ボタンをタップして復旧してください。");
    });
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && serviceWorkerRegistration && offlineStatus.dataset.state !== "checking") checkOfflineStatus();
    if (document.visibilityState === "visible" && currentTrackKey && audio.paused && playbackState.dataset.state === "playing") {
      setPlaybackState("paused", "PAUSED");
      showError("OSにより再生が停止しました。PLAY をタップして再開してください。");
    }
  });

  window.addEventListener("online", function () {
    if (serviceWorkerRegistration && offlineStatus.dataset.state === "incomplete") {
      checkOfflineStatus();
    }
  });

  registerServiceWorker();
}());

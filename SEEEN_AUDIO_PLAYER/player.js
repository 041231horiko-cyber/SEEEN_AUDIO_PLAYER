(function () {
  "use strict";

  var TRACKS = {
    "bright-wide": {
      label: "BRIGHT × WIDE",
      src: "audio/bright_wide_loop.wav"
    },
    "bright-narrow": {
      label: "BRIGHT × NARROW",
      src: "audio/bright_narrow_loop.wav"
    },
    "dark-wide": {
      label: "DARK × WIDE",
      src: "audio/dark_wide_loop.wav"
    },
    "dark-narrow": {
      label: "DARK × NARROW",
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

    var isPlaying = state === "playing";
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

  async function selectTrack(key) {
    var track = TRACKS[key];
    if (!track) {
      return;
    }

    var thisOperation = ++operationId;
    switchingOperation = thisOperation;
    clearError();
    setSelectedTrack(key);
    setPlaybackState("loading", "LOADING");

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.src = track.src;
    audio.loop = true;
    audio.load();

    try {
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

      var worker = serviceWorkerRegistration.active || serviceWorkerRegistration.waiting || serviceWorkerRegistration.installing;
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
        resolve(event.data);
      };

      worker.postMessage({ type: type }, [channel.port2]);
    });
  }

  async function checkOfflineStatus() {
    try {
      var result = await sendServiceWorkerMessage("CHECK_OFFLINE_STATUS");
      if (result && result.ready) {
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
      if (!result || !result.ready) {
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
    if (!("serviceWorker" in navigator)) {
      setOfflineState("error", "UNAVAILABLE", false);
      showError("このブラウザではオフライン機能を利用できません。iOS Safari で開いてください。");
      return;
    }

    setOfflineState("checking", "SAVING", false);

    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      serviceWorkerRegistration = await navigator.serviceWorker.ready;
      await checkOfflineStatus();
    } catch (error) {
      setOfflineState("error", "UNAVAILABLE", false);
      showError("オフライン機能を開始できません。HTTPS または localhost で開いてください。");
    }
  }

  trackButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectTrack(button.dataset.track);
    });
  });

  playToggle.addEventListener("click", togglePlayback);
  offlineStatus.addEventListener("click", repairOfflineCache);

  audio.addEventListener("play", function () {
    if (!switchingOperation && isExpectedSource()) {
      setPlaybackState("playing", "PLAYING");
    }
  });

  audio.addEventListener("pause", function () {
    if (!switchingOperation && currentTrackKey && !audio.ended && playbackState.dataset.state === "playing") {
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
    if (!currentTrackKey || !isExpectedSource()) {
      return;
    }
    setPlaybackState("error", "ERROR");
    showError(mediaErrorMessage() + " OFFLINE 状態も確認してください。");
  });

  audio.addEventListener("ended", function () {
    if (!currentTrackKey) {
      return;
    }
    audio.currentTime = 0;
    audio.play().catch(function () {
      setPlaybackState("error", "ERROR");
      showError("ループ再開に失敗しました。音源ボタンをタップして復旧してください。");
    });
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && currentTrackKey && audio.paused && playbackState.dataset.state === "playing") {
      setPlaybackState("paused", "PAUSED");
      showError("OSにより再生が停止しました。PLAY をタップして再開してください。");
    }
  });

  window.addEventListener("online", function () {
    if (offlineStatus.dataset.state !== "ready") {
      checkOfflineStatus();
    }
  });

  registerServiceWorker();
}());

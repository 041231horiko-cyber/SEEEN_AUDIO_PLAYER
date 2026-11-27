"use strict";

// キャッシュ対象を同じURLで更新したら、この値を必ず更新する。
var SCOPE = self.registration.scope;
var CACHE_VERSION = "seeen-v04-step04-v1:" + SCOPE;
var V03_SCOPE = "https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/";
var APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./knock-sync.js",
  "./melody-sync.js",
  "./player.js",
  "./particle-field.js",
  "./field.js",
  "./BarlowCondensed-SemiBold.ttf",
  "./manifest.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./knock-data/bright-wide.json",
  "./knock-data/bright-narrow.json",
  "./knock-data/dark-wide.json",
  "./knock-data/dark-narrow.json",
  "./melody-data/step04-rms.json"
];
var AUDIO_ASSETS = [
  "./audio/ui-switch.wav",
  "./audio/bright_wide_loop_125s_test.m4a",
  "./audio/bright_narrow_loop_125s_test.m4a",
  "./audio/dark_wide_loop_125s_test.m4a",
  "./audio/dark_narrow_loop_125s_test.m4a"
];
var ALL_ASSETS = APP_ASSETS.concat(AUDIO_ASSETS);
var ASSET_URLS = new Set(ALL_ASSETS.map(function (asset) { return new URL(asset, SCOPE).href; }));
var AUDIO_URLS = new Set(AUDIO_ASSETS.map(function (asset) { return new URL(asset, SCOPE).href; }));

function mediaResponse(response, url) {
  var type = new URL(url, SCOPE).pathname.endsWith(".m4a") ? "audio/mp4" : "audio/wav";
  if (response.headers.get("Content-Type") === type) return response;
  var headers = new Headers(response.headers);
  headers.set("Content-Type", type);
  if (headers.has("Content-Encoding")) {
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers: headers});
}

async function cacheAsset(cache, asset) {
  var response = await fetch(asset, { cache: "reload" });
  if (response.status !== 200) {
    throw new Error("Failed to cache " + asset + ": " + response.status);
  }
  var url = new URL(asset, SCOPE).href;
  await cache.put(url, AUDIO_URLS.has(url) ? mediaResponse(response, url) : response);
}

async function cacheAllAssets() {
  var cache = await caches.open(CACHE_VERSION);
  for (var index = 0; index < ALL_ASSETS.length; index += 1) {
    var asset = ALL_ASSETS[index];
    var stored = await cache.match(new URL(asset, SCOPE).href);
    // Retrying a partial install or a repair does not replace working entries.
    if (!stored || stored.status !== 200) await cacheAsset(cache, asset);
  }
  return verifyOfflineCache();
}

async function verifyOfflineCache() {
  var cache = await caches.open(CACHE_VERSION);
  var missing = [];

  for (var index = 0; index < ALL_ASSETS.length; index += 1) {
    var response = await cache.match(new URL(ALL_ASSETS[index], SCOPE).href);
    if (!response || response.status !== 200) {
      missing.push(ALL_ASSETS[index]);
    }
  }

  return {
    ready: missing.length === 0,
    missing: missing,
    switchCueCached: missing.indexOf("./audio/ui-switch.wav") === -1,
    cacheName: CACHE_VERSION
  };
}

self.addEventListener("install", function (event) {
  if (SCOPE.startsWith(V03_SCOPE)) {
    event.waitUntil(Promise.reject(new Error("V04 needs a separate origin or sibling scope")));
    return;
  }
  event.waitUntil(
    cacheAllAssets().then(function (result) {
      if (!result.ready) {
        throw new Error("Offline cache verification failed");
      }
      // Keep the old worker with its open pages until they close.
    })
  );
});

self.addEventListener("activate", function (event) {
  // 旧キャッシュは自動削除しない。更新時に再生中の音源を消さないための方針。
  event.waitUntil(self.clients.claim());
});

function fullAudioRequest(request) {
  return new Request(request.url, {
    method: "GET",
    headers: new Headers(),
    mode: "same-origin",
    credentials: request.credentials,
    cache: "no-store",
    redirect: "follow"
  });
}

async function getFullAudioResponse(request) {
  var cache = await caches.open(CACHE_VERSION);
  var cacheKey = fullAudioRequest(request);
  var cached = await cache.match(cacheKey, { ignoreSearch: true });
  if (cached && cached.status === 200) {
    return cached;
  }

  var response = await fetch(cacheKey);
  if (response.status !== 200) {
    throw new Error("Audio fetch failed: " + response.status);
  }
  return mediaResponse(response, cacheKey.url);
}

function rangeNotSatisfiable(size) {
  return new Response(null, {
    status: 416,
    statusText: "Range Not Satisfiable",
    headers: { "Content-Range": "bytes */" + size }
  });
}

async function createRangeResponse(response, rangeHeader) {
  // Keep the media as a Blob, not a full JS heap buffer plus a copied slice.
  var blob = await response.blob();
  var size = blob.size;
  var match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || "");

  if (!match || (!match[1] && !match[2])) {
    return rangeNotSatisfiable(size);
  }

  var start;
  var end;

  if (match[1] === "" && match[2] !== "") {
    var suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return rangeNotSatisfiable(size);
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return rangeNotSatisfiable(size);
  }

  end = Math.min(end, size - 1);
  var headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
  headers.set("Content-Length", String(end - start + 1));
  headers.delete("Content-Encoding");

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: headers
  });
}

async function handleAudioRequest(request) {
  try {
    var response = await getFullAudioResponse(request);
    var rangeHeader = request.headers.get("Range");
    if (rangeHeader) {
      return await createRangeResponse(response, rangeHeader);
    }
    return response;
  } catch (error) {
    return new Response("Audio is unavailable. Reconnect and retry offline storage.", {
      status: 503,
      statusText: "Audio Unavailable",
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function cacheFirst(request) {
  var currentCache = await caches.open(CACHE_VERSION);
  var cached = await currentCache.match(request, { ignoreSearch: true });
  if (cached) {
    return cached;
  }

  return fetch(request);
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  var url = new URL(event.request.url);
  url.search = "";
  url.hash = "";

  if (AUDIO_URLS.has(url.href)) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  if (event.request.mode === "navigate" && (url.href === SCOPE || url.href === new URL("index.html", SCOPE).href)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(new URL("index.html", SCOPE).href);
      }).then(function (cached) {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  if (ASSET_URLS.has(url.href)) event.respondWith(cacheFirst(event.request));
});

self.addEventListener("message", function (event) {
  if (!event.data || !event.data.type || !event.ports || !event.ports[0]) {
    return;
  }

  var replyPort = event.ports[0];
  var work;

  if (event.data.type === "CHECK_OFFLINE_STATUS") {
    work = verifyOfflineCache();
  } else if (event.data.type === "CACHE_ALL_ASSETS") {
    work = cacheAllAssets();
  } else {
    return;
  }

  event.waitUntil(
    work.then(function (result) {
      replyPort.postMessage(result);
    }).catch(function (error) {
      replyPort.postMessage({
        ready: false,
        missing: ALL_ASSETS,
        error: error && error.message ? error.message : "Unknown cache error"
      });
    })
  );
});

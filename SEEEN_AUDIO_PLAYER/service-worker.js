"use strict";

// 完成音源を同じファイル名で差し替えたら、この値を必ず更新する。
var CACHE_VERSION = "seeen-audio-v19";
var APP_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./player.js",
  "./field.js",
  "./seeen-logo.png",
  "./seeen-logo-white.png",
  "./BarlowCondensed-SemiBold.ttf",
  "./manifest.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
var AUDIO_ASSETS = [
  "./audio/ui-switch.wav",
  "./audio/bright_wide_loop.wav",
  "./audio/bright_narrow_loop.wav",
  "./audio/dark_wide_loop.wav",
  "./audio/dark_narrow_loop.wav"
];
var ALL_ASSETS = APP_ASSETS.concat(AUDIO_ASSETS);

async function cacheAsset(cache, asset) {
  var response = await fetch(asset, { cache: "reload" });
  if (!response.ok) {
    throw new Error("Failed to cache " + asset + ": " + response.status);
  }
  await cache.put(asset, response);
}

async function cacheAllAssets() {
  var cache = await caches.open(CACHE_VERSION);
  for (var index = 0; index < ALL_ASSETS.length; index += 1) {
    await cacheAsset(cache, ALL_ASSETS[index]);
  }
  return verifyOfflineCache();
}

async function verifyOfflineCache() {
  var cache = await caches.open(CACHE_VERSION);
  var missing = [];

  for (var index = 0; index < ALL_ASSETS.length; index += 1) {
    var response = await cache.match(ALL_ASSETS[index], { ignoreSearch: true });
    if (!response || !response.ok) {
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
  event.waitUntil(
    cacheAllAssets().then(function (result) {
      if (!result.ready) {
        throw new Error("Offline cache verification failed");
      }
      return self.skipWaiting();
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
  if (cached) {
    return cached;
  }

  var response = await fetch(cacheKey);
  if (!response.ok) {
    throw new Error("Audio fetch failed: " + response.status);
  }
  await cache.put(cacheKey, response.clone());
  return response;
}

function rangeNotSatisfiable(size) {
  return new Response(null, {
    status: 416,
    statusText: "Range Not Satisfiable",
    headers: { "Content-Range": "bytes */" + size }
  });
}

async function createRangeResponse(response, rangeHeader) {
  var buffer = await response.arrayBuffer();
  var size = buffer.byteLength;
  var match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || "");

  if (!match) {
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

  return new Response(buffer.slice(start, end + 1), {
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
      return createRangeResponse(response, rangeHeader);
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

  var response = await fetch(request);
  if (response.ok && new URL(request.url).origin === self.location.origin) {
    await currentCache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.indexOf("/audio/") !== -1) {
    event.respondWith(handleAudioRequest(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match("./index.html");
      }).then(function (cached) {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  event.respondWith(cacheFirst(event.request));
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

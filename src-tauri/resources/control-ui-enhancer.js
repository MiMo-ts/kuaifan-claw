/* Application-owned presentation fixes for the embedded OpenClaw Control UI. */
(function (global) {
  "use strict";

  var MIN_REPEAT_LENGTH = 12;
  var LIGHTBOX_ID = "kuaifan-control-ui-lightbox";

  function collapseExactDuplicateText(value) {
    if (typeof value !== "string" || value.indexOf("```") !== -1 || value.indexOf("~~~") !== -1) {
      return value;
    }

    var trimmed = value.trim();
    if (trimmed.length < MIN_REPEAT_LENGTH * 2) return value;

    for (var index = 1; index < trimmed.length - 1; index += 1) {
      if (!/\s/.test(trimmed.charAt(index))) continue;
      var first = trimmed.slice(0, index).trim();
      var second = trimmed.slice(index).trim();
      if (first.length >= MIN_REPEAT_LENGTH && first === second) return first;
    }
    return value;
  }

  function uniqueImageSources(values) {
    if (!Array.isArray(values)) return [];
    var seen = new Set();
    var unique = [];
    values.forEach(function (value) {
      if (typeof value !== "string" || !value || seen.has(value)) return;
      seen.add(value);
      unique.push(value);
    });
    return unique;
  }

  // OpenClaw renders the chat inside nested web-component shadow roots. The
  // application-owned enhancer must traverse the open roots without modifying
  // any OpenClaw source or bundle.
  function collectOpenRoots(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];

    var roots = [];
    var seen = new Set();
    var pending = [root];
    while (pending.length) {
      var current = pending.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      roots.push(current);
      current.querySelectorAll("*").forEach(function (element) {
        if (element.shadowRoot && typeof element.shadowRoot.querySelectorAll === "function") {
          pending.push(element.shadowRoot);
        }
      });
    }
    return roots;
  }

  function findAssistantGroups(root) {
    var groups = [];
    var seen = new Set();
    collectOpenRoots(root).forEach(function (scope) {
      scope.querySelectorAll(".chat-group.assistant").forEach(function (group) {
        if (seen.has(group)) return;
        seen.add(group);
        groups.push(group);
      });
    });
    return groups;
  }

  global.KuaifanControlUiPresentation = {
    collapseExactDuplicateText: collapseExactDuplicateText,
    uniqueImageSources: uniqueImageSources,
    findAssistantGroups: findAssistantGroups,
  };

  if (!global.document) return;

  function isTextLeaf(element) {
    if (!element || element.children.length !== 0) return false;
    if (!element.textContent || !element.textContent.trim()) return false;
    return !element.closest("pre, code, script, style");
  }

  function textLeaves(group) {
    return Array.from(group.querySelectorAll(".chat-bubble p, .chat-bubble li, .chat-bubble blockquote, .chat-bubble span, .chat-bubble div"))
      .filter(isTextLeaf);
  }

  function collapseAssistantText(group) {
    var previous = null;
    textLeaves(group).forEach(function (element) {
      var collapsed = collapseExactDuplicateText(element.textContent);
      if (collapsed !== element.textContent) element.textContent = collapsed;

      var current = element.textContent.trim();
      if (current.length >= MIN_REPEAT_LENGTH && current === previous) {
        element.hidden = true;
      } else {
        previous = current;
      }
    });
  }

  function mediaSource(image) {
    return image.currentSrc || image.src || image.getAttribute("src") || "";
  }

  function dedupeAssistantImages(group) {
    var seen = new Set();
    group.querySelectorAll(".chat-bubble img").forEach(function (image) {
      var source = mediaSource(image);
      if (!source || !seen.has(source)) {
        seen.add(source);
        return;
      }
      image.hidden = true;
      image.setAttribute("aria-hidden", "true");
    });
  }

  function fileNameFor(source) {
    try {
      var parsed = new URL(source, global.location.href);
      var name = parsed.pathname.split("/").pop();
      return name || "kuaifan-image";
    } catch (_error) {
      return "kuaifan-image";
    }
  }

  function ensureLightbox() {
    var existing = global.document.getElementById(LIGHTBOX_ID);
    if (existing) return existing;

    var style = global.document.createElement("style");
    style.textContent =
      "#" + LIGHTBOX_ID + "{border:0;background:transparent;padding:0;max-width:96vw;max-height:96vh;}" +
      "#" + LIGHTBOX_ID + "::backdrop{background:rgba(0,0,0,.78);}" +
      "#" + LIGHTBOX_ID + " .kuaifan-lightbox__panel{position:relative;display:flex;max-height:92vh;max-width:92vw;flex-direction:column;gap:8px;}" +
      "#" + LIGHTBOX_ID + " img{display:block;max-height:calc(92vh - 44px);max-width:92vw;object-fit:contain;background:#111;}" +
      "#" + LIGHTBOX_ID + " .kuaifan-lightbox__actions{display:flex;justify-content:flex-end;gap:8px;}" +
      "#" + LIGHTBOX_ID + " button,#" + LIGHTBOX_ID + " a{border:1px solid rgba(255,255,255,.45);background:#202020;color:#fff;padding:7px 11px;border-radius:4px;font:13px system-ui,sans-serif;text-decoration:none;cursor:pointer;}";
    global.document.head.appendChild(style);

    var dialog = global.document.createElement("dialog");
    dialog.id = LIGHTBOX_ID;
    dialog.setAttribute("aria-label", "图片预览");
    dialog.innerHTML =
      '<div class="kuaifan-lightbox__panel">' +
      '<div class="kuaifan-lightbox__actions">' +
      '<a data-kuaifan-download download>下载</a>' +
      '<button type="button" data-kuaifan-close>关闭</button>' +
      "</div>" +
      '<img data-kuaifan-image alt="" />' +
      "</div>";
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector("[data-kuaifan-close]").addEventListener("click", function () {
      dialog.close();
    });
    global.document.body.appendChild(dialog);
    return dialog;
  }

  function openImage(source, alt) {
    if (!source) return;
    var dialog = ensureLightbox();
    var image = dialog.querySelector("[data-kuaifan-image]");
    var download = dialog.querySelector("[data-kuaifan-download]");
    image.src = source;
    image.alt = alt || "生成图片";
    download.href = source;
    download.download = fileNameFor(source);
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function bindImagePreview(group) {
    group.querySelectorAll(".chat-bubble img").forEach(function (image) {
      if (image.dataset.kuaifanPreviewBound === "true") return;
      image.dataset.kuaifanPreviewBound = "true";
      image.style.cursor = "zoom-in";
      image.title = "点击预览";
      image.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openImage(mediaSource(image), image.alt);
      });
    });
  }

  function normalizeAssistantGroup(group) {
    collapseAssistantText(group);
    dedupeAssistantImages(group);
    bindImagePreview(group);
  }

  function normalizeAllAssistantGroups() {
    findAssistantGroups(global.document).forEach(normalizeAssistantGroup);
  }

  function start() {
    normalizeAllAssistantGroups();
    var scheduled = false;
    var observedRoots = new WeakSet();
    var observer = new MutationObserver(function () {
      scheduleNormalize();
    });

    function observeOpenRoots() {
      collectOpenRoots(global.document).forEach(function (root) {
        if (observedRoots.has(root)) return;
        observedRoots.add(root);
        observer.observe(root, { childList: true, subtree: true });
      });
    }

    function normalizeAndObserve() {
      normalizeAllAssistantGroups();
      observeOpenRoots();
    }

    function scheduleNormalize() {
      if (scheduled) return;
      scheduled = true;
      var callback = function () {
        scheduled = false;
        normalizeAndObserve();
      };
      if (typeof global.requestAnimationFrame === "function") {
        global.requestAnimationFrame(callback);
      } else {
        global.setTimeout(callback, 0);
      }
    }

    normalizeAndObserve();
    if (global.customElements && typeof global.customElements.whenDefined === "function") {
      global.customElements.whenDefined("openclaw-app").then(scheduleNormalize, function () {});
    }
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(globalThis);

(() => {
  "use strict";

  const MAP_SCOPE = Object.freeze({
    south: 22.472,
    west: 114.078,
    north: 22.526,
    east: 114.167
  });
  const MAP_MAX_BOUNDS = [
    [22.462, 114.068],
    [22.536, 114.177]
  ];

  const categoryCopy = window.CATEGORIES;
  const locations = window.LOCATIONS.filter((location) => (
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= MAP_SCOPE.south &&
    location.lat <= MAP_SCOPE.north &&
    location.lng >= MAP_SCOPE.west &&
    location.lng <= MAP_SCOPE.east
  ));
  const sourceCatalog = window.SOURCES;
  const DATA_DATE = "2026-10-29";
  const MAP_CENTER = [22.499, 114.1225];
  const MAP_ZOOM = 14;
  const categoryKeys = ["all", "breathe", "support", "daily"];
  const feeLabels = { free: "免費", low: "低收費", paid: "按項收費", unknown: "收費未明" };
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const searchAliases = {
    "新移民": ["新來港人士", "新來港"],
    "移民": ["新來港人士", "新來港"],
    "小朋友": ["兒童", "親子"],
    "小童": ["兒童"],
    "老人家": ["長者"],
    "老人": ["長者"],
    "睇醫生": ["醫療", "診所", "醫院"],
    "醫生": ["醫療", "診所", "醫院"],
    "搭車": ["港鐵", "巴士", "交通"],
    "坐車": ["港鐵", "巴士", "交通"],
    "交通": ["港鐵設施", "巴士及小巴設施", "的士", "車站"],
    "免費": ["免費"],
    "圖書館": ["圖書館"],
    "街市": ["街市", "市場"],
    "公園": ["公園", "花園", "遊樂場"]
  };

  const state = {
    query: "",
    theme: "all",
    district: "all",
    fee: "all",
    subcategories: new Set(),
    audiences: new Set(),
    openOnly: false,
    sortMode: "default",
    selectedId: null,
    previewId: null,
    detailTrigger: null
  };

  let map;
  let clusterGroup;
  let tileLayer;
  let markers = new Map();
  let visibleLocations = [];
  let galleryImages = [];
  let lightboxIndex = 0;
  let lightboxTrigger = null;
  let tileErrors = 0;
  let tileLoadCount = 0;
  let tilesLoaded = false;
  let mapFallbackTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const escapeHTML = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const normalize = (value = "") => String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\s+/g, "");

  const sourceFor = (key) => sourceCatalog[key] || {
    title: key,
    publisher: "資料來源",
    url: "#",
    type: "參考資料"
  };

  const categoryLabel = (key) => categoryCopy[key]?.label || key;
  const categoryClass = (key) => key === "support" ? "support" : key === "daily" ? "daily" : "breathe";

  function iconHref(category) {
    if (category === "support") return "#icon-hands";
    if (category === "daily") return "#icon-shop";
    return "#icon-leaf";
  }

  function iconMarkup(category) {
    return `<svg aria-hidden="true"><use href="${iconHref(category)}"></use></svg>`;
  }

  function hongKongClock() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Hong_Kong",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      day: weekdayMap[values.weekday],
      minutes: Number(values.hour) * 60 + Number(values.minute)
    };
  }

  function toMinutes(value) {
    if (value === "24:00") return 1440;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function openStatus(location) {
    if (!location.hours) {
      const label = location.appointment || location.referral ? "需預約／查詢" : "時間未明";
      return { code: "unknown", label, tone: "state-unknown" };
    }
    const clock = hongKongClock();
    const ranges = location.hours[clock.day] || [];
    if (!ranges.length) {
      return { code: "closed", label: "非公開時段", tone: "state-closed" };
    }
    const open = ranges.some(([start, end]) => {
      const startMin = toMinutes(start);
      const endMin = toMinutes(end);
      if (endMin < startMin) {
        return clock.minutes >= startMin || clock.minutes <= endMin;
      }
      return clock.minutes >= startMin && clock.minutes < endMin;
    });
    return {
      code: open ? "open" : "closed",
      label: open ? "按時間應開放" : "非公開時段",
      tone: open ? "state-open" : "state-closed"
    };
  }

  function isOrderedSubsequence(needle, haystack) {
    if (needle.length < 4) return false;
    let cursor = 0;
    for (const character of haystack) {
      if (character === needle[cursor]) cursor += 1;
      if (cursor === needle.length) return true;
    }
    return false;
  }

  function searchTermMatches(term, value) {
    return value.includes(term) || isOrderedSubsequence(term, value);
  }

  function isAddressIntent(term) {
    return term.length >= 4 || /(路|道|街|邨|苑|樓|號|里|巷)$/.test(term);
  }

  function searchFields(location) {
    return [
      { text: normalize(location.name), weight: 120, kind: "名稱" },
      { text: normalize(location.nameEn), weight: 100, kind: "英文名稱" },
      { text: normalize([location.district, location.subarea].filter(Boolean).join("")), weight: 70, kind: "地區" },
      { text: normalize(location.address), weight: 60, kind: "地址" },
      { text: normalize(location.subcategories?.join("")), weight: 55, kind: "分類" },
      { text: normalize(location.services?.join("")), weight: 45, kind: "服務" },
      { text: normalize(location.targetGroups?.join("")), weight: 40, kind: "對象" },
      { text: normalize(location.facilities?.join("")), weight: 30, kind: "設施" },
      { text: normalize(location.accessibility?.join("")), weight: 28, kind: "可達性" },
      { text: normalize(location.operator), weight: 22, kind: "營辦機構" },
      { text: normalize(feeLabels[location.fee]), weight: 20, kind: "收費" },
      { text: normalize(categoryLabel(location.category)), weight: 18, kind: "主題" }
    ].filter((field) => field.text);
  }

  function queryGroups(query) {
    return query.trim().split(/\s+/).filter(Boolean).map((token) => {
      const normalizedToken = normalize(token);
      return [normalizedToken, ...(searchAliases[normalizedToken] || []).map(normalize)];
    });
  }

  function searchScore(location, groups) {
    if (!groups.length) return 0;
    const fields = searchFields(location);
    let score = 0;
    for (const alternatives of groups) {
      let bestField = 0;
      for (const field of fields) {
        if (field.kind === "地址" && !alternatives.some(isAddressIntent)) continue;
        if (alternatives.some((term) => searchTermMatches(term, field.text))) {
          bestField = Math.max(bestField, field.weight);
        }
      }
      if (!bestField) return 0;
      score += bestField;
    }
    return score;
  }

  function filteredLocations() {
    const groups = queryGroups(state.query);
    let scored = locations.filter((location) => {
      if (state.theme !== "all" && location.category !== state.theme) return false;
      if (state.district !== "all" && location.district !== state.district) return false;
      if (state.fee !== "all" && location.fee !== state.fee) return false;
      if (state.subcategories.size && !location.subcategories.some((item) => state.subcategories.has(item))) return false;
      if (state.audiences.size && !(location.targetGroups || []).some((item) => state.audiences.has(item))) return false;
      if (state.openOnly && openStatus(location).code !== "open") return false;
      const score = searchScore(location, groups);
      return groups.length === 0 || score > 0;
    }).map((location) => ({
      location,
      score: searchScore(location, groups)
    }));

    let output = scored;

    if (state.sortMode === "nearby" && map) {
      const center = map.getCenter();
      output = scored.map((item) => ({
        ...item,
        distance: Math.hypot(item.location.lat - center.lat, item.location.lng - center.lng)
      })).sort((a, b) => a.distance - b.distance);
    } else if (groups.length) {
      output = scored.sort((a, b) => {
        return b.score - a.score ||
          a.location.name.localeCompare(b.location.name, "zh-Hant");
      });
    } else {
      output = scored.sort((a, b) => {
        const categoryOrder = { breathe: 0, support: 1, daily: 2 };
        return categoryOrder[a.location.category] - categoryOrder[b.location.category] ||
          a.location.name.localeCompare(b.location.name, "zh-Hant");
      });
    }

    return output.map((item) => item.location);
  }

  function renderActiveFilters() {
    const container = $("#activeFilters");
    const filters = [];
    if (state.theme !== "all") filters.push({ kind: "theme", value: state.theme, label: categoryLabel(state.theme) });
    if (state.district !== "all") filters.push({ kind: "district", value: state.district, label: state.district });
    if (state.fee !== "all") filters.push({ kind: "fee", value: state.fee, label: feeLabels[state.fee] || state.fee });
    state.subcategories.forEach((value) => filters.push({ kind: "subcategory", value, label: value }));
    state.audiences.forEach((value) => filters.push({ kind: "audience", value, label: value }));
    if (state.openOnly) filters.push({ kind: "openOnly", value: "true", label: "現在應開放" });

    container.innerHTML = filters.map((filter) => `
      <span class="active-filter">
        ${escapeHTML(filter.label)}
        <button type="button" data-remove-filter="${filter.kind}" data-value="${escapeHTML(filter.value)}" aria-label="移除${escapeHTML(filter.label)}條件">
          <svg aria-hidden="true"><use href="#icon-close"></use></svg>
        </button>
      </span>
    `).join("");

    const extraCount = filters.filter((item) => !["theme"].includes(item.kind)).length;
    $("#filterCount").hidden = extraCount === 0;
    $("#filterCount").textContent = String(extraCount);

    $$("[data-remove-filter]", container).forEach((button) => {
      button.addEventListener("click", () => {
        const { removeFilter: kind, value } = button.dataset;
        if (kind === "theme") state.theme = "all";
        if (kind === "district") state.district = "all";
        if (kind === "fee") state.fee = "all";
        if (kind === "subcategory") state.subcategories.delete(value);
        if (kind === "audience") state.audiences.delete(value);
        if (kind === "openOnly") state.openOnly = false;
        syncThemeChips();
        render();
      });
    });
  }

  function resultCard(location) {
    const status = openStatus(location);
    const image = location.image
      ? `<img class="result-thumb" src="${escapeHTML(location.image)}" alt="" loading="lazy">`
      : `<span class="result-placeholder" aria-hidden="true">${iconMarkup(location.category)}</span>`;
    return `
      <button class="result-card${state.selectedId === location.id ? " is-selected" : ""}" type="button" data-result-id="${escapeHTML(location.id)}" data-category="${escapeHTML(location.category)}">
        ${image}
        <span class="result-content">
          <span class="result-meta"><i class="quick-dot ${categoryClass(location.category)}"></i>${escapeHTML(categoryLabel(location.category))} · ${escapeHTML(location.district)} · ${escapeHTML(location.subcategories[0])}</span>
          <strong class="result-title">${escapeHTML(location.name)}</strong>
          <span class="result-address">${escapeHTML(location.address)}</span>
        </span>
        <span class="result-state ${status.tone}">${escapeHTML(status.label)}</span>
      </button>
    `;
  }

  function renderResults(list) {
    visibleLocations = list;
    const resultsList = $("#resultsList");
    const emptyState = $("#emptyState");
    const count = $("#resultsCount");
    count.textContent = `${list.length} 個地點`;
    emptyState.hidden = list.length > 0;
    resultsList.hidden = list.length === 0;
    resultsList.innerHTML = list.map(resultCard).join("");
    $$(".result-card", resultsList).forEach((button) => {
      button.addEventListener("click", () => openDetail(button.dataset.resultId, button));
    });
  }

  function markerIcon(location) {
    return L.divIcon({
      className: "",
      html: `<span class="custom-marker ${categoryClass(location.category)}">${iconMarkup(location.category)}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 31],
      popupAnchor: [0, -28]
    });
  }

  function clusterIcon(cluster) {
    return L.divIcon({
      html: `<div class="marker-cluster-custom"><span>${cluster.getChildCount()}</span></div>`,
      className: "",
      iconSize: [46, 46]
    });
  }

  function initMap() {
    if (typeof L === "undefined") {
      showMapFailure();
      return;
    }
    map = L.map("map", {
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      minZoom: MAP_ZOOM,
      maxZoom: 18,
      maxBounds: MAP_MAX_BOUNDS,
      maxBoundsViscosity: 1,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true
    });

    tileLayer = L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);

    const markMapReady = () => {
      tilesLoaded = true;
      clearTimeout(mapFallbackTimer);
      $("#mapLoading").classList.add("is-hidden");
    };

    tileLayer.on("tileload", () => {
      tileLoadCount += 1;
      markMapReady();
    });
    tileLayer.on("load", markMapReady);

    tileLayer.on("tileerror", () => {
      tileErrors += 1;
      if (tileErrors >= 8 && tileLoadCount === 0) showMapFailure();
    });

    mapFallbackTimer = window.setTimeout(() => {
      if (!tilesLoaded && tileLoadCount === 0) showMapFailure();
      else $("#mapLoading").classList.add("is-hidden");
    }, 9000);

    if (L.markerClusterGroup) {
      clusterGroup = L.markerClusterGroup({
        disableClusteringAtZoom: 17,
        maxClusterRadius: 46,
        showCoverageOnHover: false,
        iconCreateFunction: clusterIcon
      });
    } else {
      clusterGroup = L.layerGroup();
    }

    clusterGroup.addTo(map);
    map.on("click", () => closePreview());
    map.on("moveend", () => {
      if (state.sortMode === "nearby") render();
    });
    const syncMapControls = () => {
      $("#zoomOut").disabled = map.getZoom() <= map.getMinZoom();
      $("#zoomIn").disabled = map.getZoom() >= map.getMaxZoom();
    };
    map.on("zoomend", syncMapControls);
    window.setTimeout(() => {
      map.invalidateSize();
      syncMapControls();
    }, 50);
  }

  function showMapFailure() {
    $("#mapLoading").classList.add("is-hidden");
    $("#mapError").hidden = false;
  }

  function renderMarkers(list) {
    if (!map || !clusterGroup) return;
    clusterGroup.clearLayers();
    markers = new Map();
    const markerList = list.map((location) => {
      const marker = L.marker([location.lat, location.lng], {
        icon: markerIcon(location),
        title: location.name,
        alt: `${location.name}，${categoryLabel(location.category)}`,
        keyboard: true,
        riseOnHover: true
      });
      marker.on("click", () => {
        state.selectedId = location.id;
        $$(".result-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.resultId === location.id));
        showPreview(location);
      });
      markers.set(location.id, marker);
      return marker;
    });
    clusterGroup.addLayers(markerList);

    $("#mapEmpty").hidden = list.length > 0;
    if (state.previewId && !list.some((item) => item.id === state.previewId)) closePreview();
  }

  function previewMarkup(location) {
    const status = openStatus(location);
    const image = location.image
      ? `<img class="preview-image" src="${escapeHTML(location.image)}" alt="">`
      : `<span class="preview-placeholder ${categoryClass(location.category)}">${iconMarkup(location.category)}</span>`;
    return `
      <button class="preview-close" type="button" aria-label="關閉地點預覽">
        <svg aria-hidden="true"><use href="#icon-close"></use></svg>
      </button>
      ${image}
      <div class="preview-copy">
        <small>${escapeHTML(categoryLabel(location.category))} · ${escapeHTML(location.district)} · ${escapeHTML(status.label)}</small>
        <strong>${escapeHTML(location.name)}</strong>
        <span>${escapeHTML(location.address)}</span>
      </div>
      <button class="preview-action" type="button">查看詳情 <svg aria-hidden="true"><use href="#icon-arrow"></use></svg></button>
    `;
  }

  function showPreview(location) {
    state.previewId = location.id;
    const preview = $("#mapPreview");
    preview.innerHTML = previewMarkup(location);
    preview.hidden = false;
    $(".preview-close", preview).addEventListener("click", closePreview);
    $(".preview-action", preview).addEventListener("click", () => openDetail(location.id, $(".preview-action", preview)));
    const marker = markers.get(location.id);
    if (marker && map && !$("#mapPreview").hidden) {
      map.panTo([location.lat, location.lng], { animate: !prefersReducedMotion() });
    }
  }

  function closePreview() {
    state.previewId = null;
    $("#mapPreview").hidden = true;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function renderMapView(list) {
    renderMarkers(list);
  }

  function render() {
    const list = filteredLocations();
    renderActiveFilters();
    renderResults(list);
    renderMapView(list);
    updateClearSearchButton();
  }

  function openTheme(theme) {
    state.theme = categoryKeys.includes(theme) ? theme : "all";
    state.subcategories.clear();
    syncThemeChips();
    render();
  }

  function syncThemeChips() {
    $$(".theme-chip").forEach((button) => {
      const active = button.dataset.theme === state.theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateThemeCounts() {
    $$("[data-theme-count]").forEach((element) => {
      const key = element.dataset.themeCount;
      element.textContent = key === "all"
        ? String(locations.length)
        : String(locations.filter((location) => location.category === key).length);
    });
  }

  function syncSearchInputs(value) {
    if ($("#mainSearch").value !== value) $("#mainSearch").value = value;
    if ($("#heroSearchInput").value !== value) $("#heroSearchInput").value = value;
  }

  function setQuery(value, { jump = false } = {}) {
    state.query = value.trim();
    syncSearchInputs(value);
    render();
    if (jump) $("#resource-map").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function updateClearSearchButton() {
    $("#clearSearch").hidden = !state.query;
  }

  function resetAll({ clearSearch = true } = {}) {
    if (clearSearch) {
      state.query = "";
      syncSearchInputs("");
    }
    state.theme = "all";
    state.district = "all";
    state.fee = "all";
    state.subcategories.clear();
    state.audiences.clear();
    state.openOnly = false;
    state.sortMode = "default";
    $("#sortNearby").textContent = "由中心向外";
    syncThemeChips();
    closePreview();
    render();
  }

  function clearFilters() {
    state.district = "all";
    state.fee = "all";
    state.subcategories.clear();
    state.audiences.clear();
    state.openOnly = false;
    syncFilterForm();
    render();
  }

  function renderFilterChoices() {
    const container = $("#subcategoryChoices");
    const groups = state.theme === "all" ? categoryKeys.filter((key) => key !== "all") : [state.theme];
    container.innerHTML = groups.map((key) => `
      <div class="subcategory-group">
        <h4>${escapeHTML(categoryCopy[key].label)}</h4>
        <div class="check-grid">
          ${categoryCopy[key].subcategories.map((item) => `
            <label class="check-choice">
              <input type="checkbox" name="subcategory" value="${escapeHTML(item)}" ${state.subcategories.has(item) ? "checked" : ""}>
              <span>${escapeHTML(item)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function syncFilterForm() {
    const form = $("#filterForm");
    form.querySelector(`input[name="district"][value="${CSS.escape(state.district)}"]`).checked = true;
    form.querySelector(`input[name="fee"][value="${CSS.escape(state.fee)}"]`).checked = true;
    renderFilterChoices();
    $$('input[name="audience"]', form).forEach((input) => {
      input.checked = state.audiences.has(input.value);
    });
    $("#openNow").checked = state.openOnly;
  }

  function openFilterDialog() {
    syncFilterForm();
    const dialog = $("#filterDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeFilterDialog() {
    const dialog = $("#filterDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function applyFilters() {
    const form = $("#filterForm");
    const formData = new FormData(form);
    state.district = formData.get("district") || "all";
    state.fee = formData.get("fee") || "all";
    state.subcategories = new Set(formData.getAll("subcategory"));
    state.audiences = new Set(formData.getAll("audience"));
    state.openOnly = formData.get("openNow") === "on";
    closeFilterDialog();
    render();
  }

  function detailSection(title, content, category) {
    if (!content) return "";
    return `<section class="detail-section ${categoryClass(category)}"><h3>${escapeHTML(title)}</h3>${content}</section>`;
  }

  function pillList(items, className = "detail-list") {
    if (!items?.length) return "";
    return `<ul class="${className}">${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`;
  }

  function actionLink({ href, label, icon, external = true, disabled = false, onClick = "" }) {
    if (disabled) {
      return `<span class="detail-action is-disabled" aria-disabled="true"><svg aria-hidden="true"><use href="${icon}"></use></svg>${escapeHTML(label)}</span>`;
    }
    const target = external ? ' target="_blank" rel="noopener"' : "";
    const action = onClick ? ` data-detail-action="${onClick}"` : "";
    return `<a class="detail-action" href="${escapeHTML(href)}"${target}${action}><svg aria-hidden="true"><use href="${icon}"></use></svg>${escapeHTML(label)}</a>`;
  }

  function detailMarkup(location) {
    const category = location.category;
    const status = openStatus(location);
    const heroStyle = location.image ? ` style="--detail-image:url('${escapeHTML(location.image)}')"` : "";
    const phone = location.phones?.[0];
    const directions = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    const tags = [
      ...(location.subcategories || []),
      ...(location.targetGroups || []).slice(0, 3)
    ];

    const addressFacts = `
      <dl class="detail-facts">
        <dt>地址</dt><dd>${escapeHTML(location.address)}</dd>
        <dt>地區</dt><dd>${escapeHTML(location.district)} · ${escapeHTML(location.subarea || "未細分")}</dd>
        <dt>位置精度</dt><dd>${escapeHTML(location.precision || "未有公開資料")}</dd>
        ${location.transport?.length ? `<dt>前往方法</dt><dd>${location.transport.map(escapeHTML).join("；")}</dd>` : ""}
      </dl>
    `;

    const openingFacts = `
      <div class="detail-prose">
        <p><strong>${escapeHTML(location.hoursText || "未有公開時間")}</strong></p>
        ${location.openingNotes ? `<p>${escapeHTML(location.openingNotes)}</p>` : ""}
        <p>目前狀態：${escapeHTML(status.label)}。${status.code === "unknown" ? "未能按公開時間可靠判斷。" : "只按常規時間估算，未計即時特別安排。"}</p>
      </div>
    `;

    const serviceInfo = [
      location.services?.length ? `<p><strong>服務：</strong>${location.services.map(escapeHTML).join("、")}</p>` : "",
      location.targetGroups?.length ? `<p><strong>對象：</strong>${location.targetGroups.map(escapeHTML).join("、")}</p>` : "",
      location.eligibility ? `<p><strong>資格：</strong>${escapeHTML(location.eligibility)}</p>` : "",
      location.documents?.length ? `<p><strong>所需文件：</strong>${location.documents.map(escapeHTML).join("；")}</p>` : "",
      location.appointment ? `<p><strong>預約：</strong>${escapeHTML(location.appointment)}</p>` : "",
      location.referral ? `<p><strong>轉介：</strong>${escapeHTML(location.referral)}</p>` : "",
      `<p><strong>收費：</strong>${escapeHTML(feeLabels[location.fee] || "未有公開資料")}${location.feeNotes ? `；${escapeHTML(location.feeNotes)}` : ""}</p>`,
      location.languages?.length ? `<p><strong>語言：</strong>${location.languages.map(escapeHTML).join("、")}</p>` : ""
    ].filter(Boolean).join("<br>");

    const facilities = [
      location.facilities?.length ? `<p><strong>設施：</strong>${location.facilities.map(escapeHTML).join("、")}</p>` : "",
      location.accessibility?.length ? `<p><strong>可達性資料：</strong>${location.accessibility.map(escapeHTML).join("；")}</p>` : ""
    ].filter(Boolean).join("");

    const tips = pillList(location.tips, "detail-notes");
    const storySource = location.story ? sourceFor(location.story.source) : null;
    const storyCitation = storySource
      ? (storySource.url
        ? `<a href="${escapeHTML(storySource.url)}" target="_blank" rel="noopener">來源：${escapeHTML(storySource.title)}</a>`
        : `<span class="source-note">來源：${escapeHTML(storySource.title)}</span>`)
      : "";
    const story = location.story ? `
      <div class="story-box">
        <h4>${escapeHTML(location.story.title)}</h4>
        <p>${escapeHTML(location.story.text)}</p>
        ${storyCitation}
      </div>
    ` : "";

    const sources = (location.sources || []).map((key) => {
      const source = sourceFor(key);
      const label = `${escapeHTML(source.title)}<small>${escapeHTML(source.publisher)} · ${escapeHTML(source.type)}</small>`;
      return `<li>${source.url
        ? `<a href="${escapeHTML(source.url)}" target="_blank" rel="noopener">${label}</a>`
        : `<span class="source-note">${label}</span>`}</li>`;
    }).join("");

    return `
      <div class="detail-hero ${categoryClass(category)}${location.image ? " has-image" : ""}"${heroStyle}>
        <div class="detail-category"><i class="quick-dot ${categoryClass(category)}"></i>${escapeHTML(categoryLabel(category))}</div>
        <h2 id="detailTitle">${escapeHTML(location.name)}</h2>
        ${location.nameEn ? `<p class="detail-en">${escapeHTML(location.nameEn)}</p>` : ""}
      </div>
      <div class="detail-body">
        <div class="detail-actions" aria-label="地點操作">
          ${phone
            ? actionLink({ href: `tel:${phone.number.replace(/\s/g, "")}`, label: "致電", icon: "#icon-phone", external: false })
            : actionLink({ href: "#", label: "未有電話", icon: "#icon-phone", disabled: true })}
          ${actionLink({ href: directions, label: "路線", icon: "#icon-route" })}
          ${location.website
            ? actionLink({ href: location.website, label: "官方網站", icon: "#icon-link" })
            : actionLink({ href: "#", label: "未有網站", icon: "#icon-link", disabled: true })}
        </div>
        <p class="detail-summary">${escapeHTML(location.summary)}</p>
        <div class="detail-tags">
          <span class="detail-tag fee">${escapeHTML(feeLabels[location.fee] || "收費未明")}</span>
          ${tags.map((tag) => `<span class="detail-tag">${escapeHTML(tag)}</span>`).join("")}
        </div>
        ${detailSection("地址與前往", addressFacts, category)}
        ${detailSection("開放及服務安排", openingFacts, category)}
        ${detailSection("服務、對象與費用", serviceInfo, category)}
        ${facilities ? detailSection("設施及可達性", facilities, category) : ""}
        ${tips ? detailSection("實用提示", tips, category) : ""}
        ${story ? detailSection("義工手記", story, category) : ""}
        ${sources ? detailSection("資料來源", `<ul class="source-list">${sources}</ul>`, category) : ""}
        <div class="detail-meta">資料日期：${escapeHTML(location.dataDate || DATA_DATE)} · 完整度：${escapeHTML(location.completeness || "基本收錄")}</div>
        <div class="detail-notice">本頁為固定資料版本。前往、致電或申請前，請向相關機構確認最新安排。</div>
      </div>
    `;
  }

  function openDetail(id, trigger = null) {
    const location = locations.find((item) => item.id === id);
    if (!location) return;
    state.selectedId = id;
    state.detailTrigger = trigger || document.activeElement;
    $("#detailContent").innerHTML = detailMarkup(location);
    const panel = $("#detailPanel");
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    panel.scrollTop = 0;
    const isMobile = window.matchMedia("(max-width: 620px)").matches;
    panel.setAttribute("aria-modal", String(isMobile));
    $("#detailBackdrop").hidden = !isMobile;
    document.body.style.overflow = isMobile ? "hidden" : "";
    $$(".result-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.resultId === id));
    if (map && markers.has(id)) {
      map.panTo([location.lat, location.lng], {
        animate: !prefersReducedMotion()
      });
      if (map.getZoom() < 15) {
        map.setZoom(15, { animate: !prefersReducedMotion() });
      }
    }
    window.setTimeout(() => $("#closeDetail").focus({ preventScroll: true }), 40);
  }

  function closeDetail() {
    const panel = $("#detailPanel");
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    $("#detailBackdrop").hidden = true;
    document.body.style.overflow = "";
    state.selectedId = null;
    $$(".result-card").forEach((card) => card.classList.remove("is-selected"));
    if (state.detailTrigger && document.contains(state.detailTrigger)) {
      state.detailTrigger.focus({ preventScroll: true });
    }
  }

  function trapDetailFocus(event) {
    const panel = $("#detailPanel");
    if (!panel.classList.contains("is-open") || event.key !== "Tab" || !window.matchMedia("(max-width: 620px)").matches) return;
    const focusable = $$("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])", panel)
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function trapLightboxFocus(event) {
    const lightbox = $("#imageLightbox");
    if (lightbox.hidden || event.key !== "Tab") return;
    const focusable = $$("button:not([disabled])", lightbox).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openLightbox(index, trigger) {
    if (!galleryImages.length) return;
    lightboxTrigger = trigger || document.activeElement;
    lightboxIndex = (index + galleryImages.length) % galleryImages.length;
    const item = galleryImages[lightboxIndex];
    $("#lightboxImage").src = item.src;
    $("#lightboxImage").alt = item.title;
    $("#lightboxTitle").textContent = item.title;
    $("#imageLightbox").hidden = false;
    document.body.style.overflow = "hidden";
    $("#closeLightbox").focus({ preventScroll: true });
  }

  function closeLightbox() {
    $("#imageLightbox").hidden = true;
    document.body.style.overflow = "";
    if (lightboxTrigger && document.contains(lightboxTrigger)) {
      lightboxTrigger.focus({ preventScroll: true });
    }
  }

  function moveLightbox(step) {
    if ($("#imageLightbox").hidden) return;
    openLightbox(lightboxIndex + step, lightboxTrigger);
  }

  function bindEvents() {
    $("#heroSearch").addEventListener("submit", (event) => {
      event.preventDefault();
      setQuery($("#heroSearchInput").value, { jump: true });
    });

    let searchTimer;
    $("#mainSearch").addEventListener("input", (event) => {
      window.clearTimeout(searchTimer);
      const value = event.target.value;
      $("#heroSearchInput").value = value;
      searchTimer = window.setTimeout(() => {
        state.query = value.trim();
        render();
      }, 120);
    });

    $("#clearSearch").addEventListener("click", () => {
      setQuery("");
      $("#mainSearch").focus();
    });

    $$(".theme-chip").forEach((button) => {
      button.addEventListener("click", () => openTheme(button.dataset.theme));
    });

    $$("[data-quick-theme]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openTheme(link.dataset.quickTheme);
        $("#resource-map").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
      });
    });

    $("#openFilters").addEventListener("click", openFilterDialog);
    $$("[data-close-filter]").forEach((button) => button.addEventListener("click", closeFilterDialog));
    $("#filterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      applyFilters();
    });
    $("#clearFilters").addEventListener("click", clearFilters);
    $("#emptyReset").addEventListener("click", () => resetAll({ clearSearch: true }));
    $("#mapEmptyReset").addEventListener("click", () => resetAll({ clearSearch: true }));
    $("#resetMap").addEventListener("click", () => {
      if (map) map.setView(MAP_CENTER, MAP_ZOOM, { animate: !prefersReducedMotion() });
    });
    $("#mapHome").addEventListener("click", () => {
      if (map) map.setView(MAP_CENTER, MAP_ZOOM, { animate: !prefersReducedMotion() });
      closePreview();
    });
    $("#zoomIn").addEventListener("click", () => map?.zoomIn());
    $("#zoomOut").addEventListener("click", () => map?.zoomOut());

    $("#sortNearby").addEventListener("click", () => {
      state.sortMode = state.sortMode === "nearby" ? "default" : "nearby";
      $("#sortNearby").textContent = state.sortMode === "nearby" ? "改為名稱排序" : "由中心向外";
      render();
    });

    $$(".view-toggle button").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        $(".app-body").dataset.mobileView = view;
        $$(".view-toggle button").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        if (view === "map") window.setTimeout(() => map?.invalidateSize(), 60);
      });
    });

    $("#closeDetail").addEventListener("click", closeDetail);
    $("#detailBackdrop").addEventListener("click", closeDetail);
    $("#closeLightbox").addEventListener("click", closeLightbox);
    $("#prevImage").addEventListener("click", () => moveLightbox(-1));
    $("#nextImage").addEventListener("click", () => moveLightbox(1));
    $("#imageLightbox").addEventListener("click", (event) => {
      if (event.target === $("#imageLightbox")) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#imageLightbox").hidden) {
        closeLightbox();
        return;
      }
      if (event.key === "ArrowLeft" && !$("#imageLightbox").hidden) {
        moveLightbox(-1);
        return;
      }
      if (event.key === "ArrowRight" && !$("#imageLightbox").hidden) {
        moveLightbox(1);
        return;
      }
      if (event.key === "Escape" && $("#detailPanel").classList.contains("is-open")) closeDetail();
      trapLightboxFocus(event);
      trapDetailFocus(event);
    });

    $$("[data-open-place]").forEach((button) => {
      button.addEventListener("click", () => openDetail(button.dataset.openPlace, button));
    });
    $$("[data-open-map-place]").forEach((button) => {
      button.addEventListener("click", () => {
        $("#resource-map").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
        openDetail(button.dataset.openMapPlace, button);
      });
    });

    $$("[data-open-about]").forEach((button) => {
      button.addEventListener("click", () => {
        $("#about-map").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
      });
    });

    galleryImages = $$("[data-lightbox-src]").map((button) => ({
      src: button.dataset.lightboxSrc,
      title: button.dataset.lightboxTitle
    }));
    $$("[data-lightbox-src]").forEach((button, index) => {
      button.addEventListener("click", () => openLightbox(index, button));
    });

    window.addEventListener("resize", () => {
      const isMobile = window.matchMedia("(max-width: 620px)").matches;
      if ($("#detailPanel").classList.contains("is-open")) {
        $("#detailPanel").setAttribute("aria-modal", String(isMobile));
        $("#detailBackdrop").hidden = !isMobile;
        document.body.style.overflow = isMobile ? "hidden" : "";
      }
      if (window.innerWidth > 900) {
        $(".app-body").dataset.mobileView = "map";
        $$(".view-toggle button").forEach((button) => {
          const active = button.dataset.view === "map";
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }
    });
  }

  function init() {
    bindEvents();
    syncThemeChips();
    updateThemeCounts();
    initMap();
    render();
    window.setTimeout(() => {
      if (!tilesLoaded) {
        $("#mapLoading").classList.add("is-hidden");
      }
    }, 10000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

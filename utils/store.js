const STORAGE_KEY = "cosmetics-tracker-mini-store-v1";
const BACKUP_VERSION = 1;
const CLOUD_COLLECTION = "cosmetics_tracker_user_stores";
const CLOUD_STORE_KEY = "default";
const cloudConfig = require("./cloudConfig");

const DEFAULT_CATEGORIES = ["洁面", "爽肤水", "精华", "乳霜", "防晒", "彩妆"];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NEXT_STOCK_STATUSES = ["active", "finished"];
let cloudSyncTimer = null;
let cloudInitialized = false;
let cloudSyncing = false;
let cloudPulling = false;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trim(value) {
  return String(value || "").trim();
}

function cloneItem(item) {
  return { ...item };
}

function cloneItems(items) {
  return (Array.isArray(items) ? items : []).map(cloneItem);
}

function cloneStore(store) {
  return {
    ...(store || {}),
    categories: cloneItems(store && store.categories),
    products: cloneItems(store && store.products),
    stocks: cloneItems(store && store.stocks),
    records: cloneItems(store && store.records),
    sync: {
      pendingCloudSync: false,
      lastSyncedAt: "",
      lastCloudPulledAt: "",
      lastCloudError: "",
      updatedAt: "",
      ...((store && store.sync) || {})
    }
  };
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }
  const dateKey = String(value);
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error("日期格式需为 YYYY-MM-DD");
  }
  const parsed = parseLocalDate(dateKey);
  if (todayKey(parsed) !== dateKey) {
    throw new Error("日期不存在，请选择有效日期");
  }
  return dateKey;
}

function normalizePositiveInteger(value) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("数量需为 1 或以上整数");
  }
  return quantity;
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(key) {
  const parts = String(key).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localFirstWeekday() {
  try {
    const language = typeof wx !== "undefined" ? wx.getSystemInfoSync().language : undefined;
    if (typeof Intl !== "undefined" && Intl.Locale) {
      const locale = new Intl.Locale(language || "zh-CN");
      const firstDay = locale.weekInfo && locale.weekInfo.firstDay;
      if (firstDay) {
        return firstDay === 7 ? 0 : firstDay;
      }
    }
  } catch (error) {
    return 1;
  }
  return 1;
}

function weekDaysContaining(dateKey, firstWeekday = localFirstWeekday()) {
  const date = parseLocalDate(dateKey);
  const jsWeekday = date.getDay();
  const offset = (jsWeekday - firstWeekday + 7) % 7;
  const start = addDays(date, -offset);
  return Array.from({ length: 7 }, (_, index) => todayKey(addDays(start, index)));
}

function emptyStore() {
  return {
    categories: [],
    products: [],
    stocks: [],
    records: [],
    sync: {
      pendingCloudSync: false,
      lastSyncedAt: "",
      lastCloudPulledAt: "",
      lastCloudError: "",
      updatedAt: ""
    }
  };
}

function readStore() {
  const fallback = emptyStore();
  const store = typeof wx === "undefined"
    ? globalThis.__COSMETICS_TRACKER_TEST_STORE__ || fallback
    : wx.getStorageSync(STORAGE_KEY) || fallback;
  return cloneStore(store);
}

function writeStore(store) {
  const nextStore = cloneStore(store);
  if (typeof wx === "undefined") {
    globalThis.__COSMETICS_TRACKER_TEST_STORE__ = nextStore;
    return;
  }
  wx.setStorageSync(STORAGE_KEY, nextStore);
}

function markPendingCloudSync(store, errorMessage = "") {
  return {
    ...store,
    sync: {
      ...((store && store.sync) || {}),
      pendingCloudSync: true,
      lastCloudError: errorMessage,
      updatedAt: nowIso()
    }
  };
}

function markCloudSynced(store, syncedAt = nowIso()) {
  return {
    ...store,
    sync: {
      ...((store && store.sync) || {}),
      pendingCloudSync: false,
      lastSyncedAt: syncedAt,
      lastCloudError: ""
    }
  };
}

function writeStoreAndScheduleCloudSync(store) {
  if (!cloudConfig.enabled) {
    writeStore(store);
    return;
  }
  writeStore(markPendingCloudSync(store));
  scheduleCloudSync();
}

function hasCloudRuntime() {
  return cloudConfig.enabled && typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.database === "function";
}

function cloudCollection() {
  return wx.cloud.database().collection(CLOUD_COLLECTION);
}

function cloudStorePayload(store) {
  return {
    categories: cloneItems(store.categories),
    products: cloneItems(store.products),
    stocks: cloneItems(store.stocks),
    records: cloneItems(store.records)
  };
}

function storeFromCloudPayload(payload) {
  return {
    ...emptyStore(),
    categories: cloneItems(payload && payload.categories),
    products: cloneItems(payload && payload.products),
    stocks: cloneItems(payload && payload.stocks),
    records: cloneItems(payload && payload.records)
  };
}

function normalizeImportedItems(items, fieldName) {
  if (!Array.isArray(items)) {
    throw new Error(`${fieldName} 格式不正确`);
  }
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldName} 中存在无效数据`);
    }
    return { ...item };
  });
}

function normalizeImportedStore(payload) {
  const data = payload && payload.data ? payload.data : payload;
  const nextStore = {
    ...emptyStore(),
    categories: normalizeImportedItems(data && data.categories, "分类"),
    products: normalizeImportedItems(data && data.products, "产品"),
    stocks: normalizeImportedItems(data && data.stocks, "库存"),
    records: normalizeImportedItems(data && data.records, "记录")
  };
  if (nextStore.categories.length === 0) {
    throw new Error("导入数据至少需要包含一个分类");
  }
  return nextStore;
}

function cloudDocQuery() {
  return cloudCollection().where({ storeKey: CLOUD_STORE_KEY }).limit(1).get();
}

function scheduleCloudSync() {
  if (!hasCloudRuntime()) {
    return;
  }
  if (cloudSyncTimer) {
    clearTimeout(cloudSyncTimer);
  }
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    flushCloudSync();
  }, 800);
}

function ensureSeedData() {
  const store = readStore();
  if (store.categories.length > 0) {
    return store;
  }
  const timestamp = nowIso();
  const categories = DEFAULT_CATEGORIES.map((name, index) => ({
    id: createId("cat"),
    name,
    sortOrder: index,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
  const nextStore = { ...store, categories };
  writeStore(nextStore);
  return nextStore;
}

function listCategories() {
  return ensureSeedData()
    .categories
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(cloneItem);
}

function addCategory(name) {
  const categoryName = trim(name);
  if (!categoryName) {
    throw new Error("分类名称不能为空");
  }
  const store = ensureSeedData();
  const existing = store.categories.find((item) => item.name === categoryName);
  if (existing) {
    return cloneItem(existing);
  }
  const category = {
    id: createId("cat"),
    name: categoryName,
    sortOrder: store.categories.length,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  writeStoreAndScheduleCloudSync({
    ...store,
    categories: [...store.categories, category]
  });
  return cloneItem(category);
}

function deleteCategory(id) {
  const store = ensureSeedData();
  const category = store.categories.find((item) => item.id === id);
  if (!category) {
    return;
  }
  if (store.categories.length <= 1) {
    throw new Error("至少保留一个分类");
  }
  const isUsed = store.products.some((product) => product.categoryId === id);
  if (isUsed) {
    throw new Error("分类已被产品使用，不能删除");
  }
  const categories = store.categories
    .filter((item) => item.id !== id)
    .map((item, index) => ({
      ...item,
      sortOrder: index,
      updatedAt: nowIso()
    }));
  writeStoreAndScheduleCloudSync({ ...store, categories });
}

function findOrCreateCategoryInStore(store, name) {
  const categoryName = trim(name) || "未分类";
  const existing = store.categories.find((item) => item.name === categoryName);
  if (existing) {
    return { store, category: existing };
  }
  const category = {
    id: createId("cat"),
    name: categoryName,
    sortOrder: store.categories.length,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return {
    store: {
      ...store,
      categories: [...store.categories, category]
    },
    category
  };
}

function findOrCreateProduct(store, input) {
  const name = trim(input.name);
  const categoryName = trim(input.categoryName) || "未分类";
  if (!name) {
    throw new Error("产品名称不能为空");
  }
  const categoryResult = findOrCreateCategoryInStore(store, categoryName);
  const existing = categoryResult.store.products.find((product) => product.name === name && product.categoryId === categoryResult.category.id);
  if (existing) {
    return { store: categoryResult.store, product: existing, category: categoryResult.category };
  }
  const product = {
    id: createId("prod"),
    name,
    categoryId: categoryResult.category.id,
    spec: "",
    capacity: trim(input.capacity),
    expiryDate: normalizeDate(input.expiryDate),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return {
    store: {
      ...categoryResult.store,
      products: [...categoryResult.store.products, product]
    },
    product,
    category: categoryResult.category
  };
}

function addUsageRecord(input) {
  const productResult = findOrCreateProduct(ensureSeedData(), input);
  const record = {
    id: createId("usage"),
    date: normalizeDate(input.date) || todayKey(),
    timeOfDay: input.timeOfDay === "evening" ? "evening" : "morning",
    productId: productResult.product.id,
    stockItemId: input.stockItemId || "",
    productNameSnapshot: productResult.product.name,
    categoryNameSnapshot: productResult.category.name,
    amount: trim(input.amount),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  writeStoreAndScheduleCloudSync({
    ...productResult.store,
    records: [record, ...productResult.store.records]
  });
  return cloneItem(record);
}

function updateUsageRecord(id, input) {
  const store = ensureSeedData();
  const existing = store.records.find((record) => record.id === id);
  if (!existing) {
    throw new Error("记录不存在");
  }
  const productResult = findOrCreateProduct(store, input);
  const record = {
    ...existing,
    date: normalizeDate(input.date) || existing.date,
    timeOfDay: input.timeOfDay === "evening" ? "evening" : "morning",
    productId: productResult.product.id,
    productNameSnapshot: productResult.product.name,
    categoryNameSnapshot: productResult.category.name,
    amount: trim(input.amount),
    updatedAt: nowIso()
  };
  writeStoreAndScheduleCloudSync({
    ...productResult.store,
    records: productResult.store.records.map((item) => (item.id === id ? record : item))
  });
  return cloneItem(record);
}

function deleteUsageRecord(id) {
  const store = ensureSeedData();
  writeStoreAndScheduleCloudSync({
    ...store,
    records: store.records.filter((record) => record.id !== id)
  });
}

function addStock(input) {
  const quantity = normalizePositiveInteger(input.quantity);
  const productResult = findOrCreateProduct(ensureSeedData(), input);
  const stock = {
    id: createId("stock"),
    productId: productResult.product.id,
    status: "stocked",
    quantity,
    openedDate: "",
    finishedDate: "",
    productNameSnapshot: productResult.product.name,
    categoryNameSnapshot: productResult.category.name,
    specSnapshot: "",
    capacitySnapshot: trim(input.capacity),
    expiryDateSnapshot: normalizeDate(input.expiryDate),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  writeStoreAndScheduleCloudSync({
    ...productResult.store,
    stocks: [stock, ...productResult.store.stocks]
  });
  return cloneItem(stock);
}

function updateStock(id, input) {
  const quantity = normalizePositiveInteger(input.quantity);
  const store = ensureSeedData();
  const existing = store.stocks.find((stock) => stock.id === id);
  if (!existing) {
    throw new Error("库存不存在");
  }
  const productResult = findOrCreateProduct(store, input);
  const stock = {
    ...existing,
    productId: productResult.product.id,
    quantity,
    productNameSnapshot: productResult.product.name,
    categoryNameSnapshot: productResult.category.name,
    capacitySnapshot: trim(input.capacity),
    expiryDateSnapshot: normalizeDate(input.expiryDate),
    updatedAt: nowIso()
  };
  writeStoreAndScheduleCloudSync({
    ...productResult.store,
    stocks: productResult.store.stocks.map((item) => (item.id === id ? stock : item))
  });
  return cloneItem(stock);
}

function nextStockForStatus(stock, status, dateKey) {
  if (stock.status === status) {
    return stock;
  }
  if (status === "active" && stock.status === "stocked") {
    return {
      ...stock,
      status: "active",
      openedDate: dateKey,
      updatedAt: nowIso()
    };
  }
  if (status === "finished" && stock.status === "active") {
    return {
      ...stock,
      status: "finished",
      finishedDate: dateKey,
      updatedAt: nowIso()
    };
  }
  throw new Error("库存状态流转无效");
}

function updateStockStatus(id, status, date = todayKey()) {
  if (!NEXT_STOCK_STATUSES.includes(status)) {
    throw new Error("库存状态无效");
  }
  const dateKey = normalizeDate(date) || todayKey();
  const store = ensureSeedData();
  const stock = store.stocks.find((item) => item.id === id);
  if (!stock) {
    throw new Error("库存不存在");
  }
  if (stock.status === "stocked" && status === "active" && stock.quantity > 1) {
    const timestamp = nowIso();
    const stockedStock = {
      ...stock,
      quantity: stock.quantity - 1,
      updatedAt: timestamp
    };
    const activeStock = {
      ...stock,
      id: createId("stock"),
      status: "active",
      quantity: 1,
      openedDate: dateKey,
      updatedAt: timestamp
    };
    writeStoreAndScheduleCloudSync({
      ...store,
      stocks: store.stocks.flatMap((item) => (item.id === id ? [activeStock, stockedStock] : [item]))
    });
    return cloneItem(activeStock);
  }
  const nextStock = nextStockForStatus(stock, status, dateKey);
  writeStoreAndScheduleCloudSync({
    ...store,
    stocks: store.stocks.map((item) => (item.id === id ? nextStock : item))
  });
  return cloneItem(nextStock);
}

function deleteStock(id) {
  const store = ensureSeedData();
  const stock = store.stocks.find((item) => item.id === id);
  if (!stock) {
    return;
  }
  if (stock.status !== "stocked") {
    throw new Error("只能删除未开瓶库存");
  }
  writeStoreAndScheduleCloudSync({
    ...store,
    stocks: store.stocks.filter((item) => item.id !== id)
  });
}

function listTodayRecords(dateKey = todayKey()) {
  return ensureSeedData()
    .records
    .filter((record) => record.date === dateKey)
    .map(cloneItem);
}

function listStocks(status) {
  const stocks = ensureSeedData().stocks;
  if (!status) {
    return stocks.map(cloneItem);
  }
  return stocks.filter((stock) => stock.status === status).map(cloneItem);
}

function productOptions() {
  const store = ensureSeedData();
  const names = new Set(store.products.map((product) => product.name));
  store.records.forEach((record) => names.add(record.productNameSnapshot));
  store.stocks.forEach((stock) => names.add(stock.productNameSnapshot));
  return Array.from(names).filter(Boolean).sort();
}

function threeDayStats(baseDateKey = todayKey()) {
  const store = ensureSeedData();
  return [2, 1, 0].map((offset) => {
    const date = todayKey(addDays(parseLocalDate(baseDateKey), -offset));
    const records = store.records.filter((record) => record.date === date);
    return {
      date,
      count: records.length,
      products: records.map((record) => record.productNameSnapshot)
    };
  });
}

function weeklyStats(baseDateKey = todayKey(), firstWeekday = localFirstWeekday()) {
  const store = ensureSeedData();
  const currentDays = weekDaysContaining(baseDateKey, firstWeekday);
  const previousDays = weekDaysContaining(todayKey(addDays(parseLocalDate(currentDays[0]), -7)), firstWeekday);
  const grouped = store.records.reduce((summaryMap, record) => {
    const bucket = currentDays.includes(record.date) ? "current" : previousDays.includes(record.date) ? "previous" : "";
    if (!bucket) {
      return summaryMap;
    }
    const key = record.productNameSnapshot;
    const summary = summaryMap.get(key) || { productName: key, categoryName: record.categoryNameSnapshot, count: 0, previousCount: 0 };
    summaryMap.set(key, {
      ...summary,
      count: bucket === "current" ? summary.count + 1 : summary.count,
      previousCount: bucket === "previous" ? summary.previousCount + 1 : summary.previousCount
    });
    return summaryMap;
  }, new Map());
  return Array.from(grouped.values()).sort((left, right) => right.count - left.count || left.productName.localeCompare(right.productName));
}

function weeklyUsageMatrix(baseDateKey = todayKey(), firstWeekday = localFirstWeekday()) {
  const store = ensureSeedData();
  const days = weekDaysContaining(baseDateKey, firstWeekday);
  const grouped = store.records.reduce((summaryMap, record) => {
    if (!days.includes(record.date)) {
      return summaryMap;
    }
    const summary = summaryMap.get(record.productNameSnapshot) || {
      productName: record.productNameSnapshot,
      categoryName: record.categoryNameSnapshot,
      total: 0,
      days: {}
    };
    if (!summary.days[record.date]) {
      summary.total += 1;
    }
    summary.days[record.date] = true;
    summaryMap.set(record.productNameSnapshot, summary);
    return summaryMap;
  }, new Map());
  return {
    days,
    rows: Array.from(grouped.values()).sort((left, right) => right.total - left.total || left.productName.localeCompare(right.productName))
  };
}

async function initCloudSync(options = {}) {
  if (!hasCloudRuntime()) {
    return { enabled: false, reason: "wx.cloud unavailable" };
  }
  if (!cloudInitialized) {
    const initOptions = options.env ? { env: options.env, traceUser: true } : { traceUser: true };
    wx.cloud.init(initOptions);
    cloudInitialized = true;
  }
  await refreshFromCloud();
  return flushCloudSync();
}

async function refreshFromCloud() {
  if (!hasCloudRuntime() || cloudPulling) {
    return { updated: false };
  }
  const localStore = ensureSeedData();
  if (localStore.sync && localStore.sync.pendingCloudSync) {
    return { updated: false, skipped: "pending-local-sync" };
  }

  cloudPulling = true;
  try {
    const result = await cloudDocQuery();
    const remoteDoc = result && result.data && result.data[0];
    if (!remoteDoc || !remoteDoc.store) {
      return { updated: false };
    }
    const pulledAt = nowIso();
    const nextStore = storeFromCloudPayload(remoteDoc.store);
    writeStore({
      ...nextStore,
      sync: {
        ...nextStore.sync,
        pendingCloudSync: false,
        lastSyncedAt: remoteDoc.updatedAt || "",
        lastCloudPulledAt: pulledAt,
        lastCloudError: "",
        updatedAt: remoteDoc.updatedAt || pulledAt
      }
    });
    return { updated: true };
  } catch (error) {
    const store = readStore();
    writeStore({
      ...store,
      sync: {
        ...store.sync,
        lastCloudError: error.message || "云端数据拉取失败"
      }
    });
    return { updated: false, error };
  } finally {
    cloudPulling = false;
  }
}

async function flushCloudSync() {
  if (!hasCloudRuntime() || cloudSyncing) {
    return { synced: false };
  }
  const store = ensureSeedData();
  if (!store.sync || !store.sync.pendingCloudSync) {
    return { synced: false, skipped: "no-pending-change" };
  }

  cloudSyncing = true;
  try {
    const updatedAt = store.sync.updatedAt || nowIso();
    const payload = {
      storeKey: CLOUD_STORE_KEY,
      store: cloudStorePayload(store),
      updatedAt
    };
    const result = await cloudDocQuery();
    const remoteDoc = result && result.data && result.data[0];
    if (remoteDoc && remoteDoc._id) {
      await cloudCollection().doc(remoteDoc._id).update({ data: payload });
    } else {
      await cloudCollection().add({ data: payload });
    }
    writeStore(markCloudSynced(readStore(), nowIso()));
    return { synced: true };
  } catch (error) {
    const currentStore = readStore();
    writeStore(markPendingCloudSync(currentStore, error.message || "云端同步失败"));
    return { synced: false, error };
  } finally {
    cloudSyncing = false;
  }
}

function cloudSyncStatus() {
  const store = readStore();
  return {
    pendingCloudSync: !!(store.sync && store.sync.pendingCloudSync),
    lastSyncedAt: store.sync ? store.sync.lastSyncedAt : "",
    lastCloudPulledAt: store.sync ? store.sync.lastCloudPulledAt : "",
    lastCloudError: store.sync ? store.sync.lastCloudError : ""
  };
}

function exportStoreSnapshot() {
  return {
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    data: cloudStorePayload(ensureSeedData())
  };
}

function importStoreSnapshot(snapshot) {
  const payload = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
  const nextStore = normalizeImportedStore(payload);
  writeStoreAndScheduleCloudSync({
    ...nextStore,
    sync: {
      ...nextStore.sync,
      updatedAt: nowIso()
    }
  });
  return cloneStore(nextStore);
}

function resetStoreForTests() {
  writeStore(emptyStore());
}

module.exports = {
  addCategory,
  addStock,
  addUsageRecord,
  cloudSyncStatus,
  deleteCategory,
  deleteStock,
  deleteUsageRecord,
  flushCloudSync,
  ensureSeedData,
  exportStoreSnapshot,
  importStoreSnapshot,
  initCloudSync,
  listCategories,
  listStocks,
  listTodayRecords,
  productOptions,
  refreshFromCloud,
  resetStoreForTests,
  threeDayStats,
  todayKey,
  updateStock,
  updateStockStatus,
  updateUsageRecord,
  weekDaysContaining,
  weeklyUsageMatrix,
  weeklyStats
};

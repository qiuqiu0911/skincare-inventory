const assert = require("node:assert/strict");
const store = require("../utils/store");
const cloudConfig = require("../utils/cloudConfig");

function reset() {
  store.resetStoreForTests();
  store.ensureSeedData();
}

function testUsageRecordCreatesProductAndCategory() {
  reset();
  store.addUsageRecord({
    name: "维稳精华",
    categoryName: "精华",
    amount: "2 泵",
    timeOfDay: "evening",
    date: "2026-06-07"
  });

  const records = store.listTodayRecords("2026-06-07");
  assert.equal(records.length, 1);
  assert.equal(records[0].productNameSnapshot, "维稳精华");
  assert.equal(records[0].categoryNameSnapshot, "精华");
  assert.deepEqual(store.productOptions(), ["维稳精华"]);
}

function testStockLifecycleAndDeleteBoundary() {
  reset();
  const stock = store.addStock({
    name: "防晒乳",
    categoryName: "防晒",
    capacity: "50ml",
    quantity: 1,
    expiryDate: "2026-12-31"
  });

  assert.equal(store.listStocks("stocked").length, 1);
  store.updateStockStatus(stock.id, "active", "2026-06-07");
  assert.equal(store.listStocks("stocked").length, 0);
  assert.equal(store.listStocks("active").length, 1);
  assert.equal(store.listStocks("active")[0].openedDate, "2026-06-07");
  assert.throws(() => store.deleteStock(stock.id), /只能删除未开瓶库存/);
  store.updateStockStatus(stock.id, "finished", "2026-06-08");
  assert.equal(store.listStocks("finished").length, 1);
  assert.equal(store.listStocks("finished")[0].finishedDate, "2026-06-08");
}

function testDeleteStockedItem() {
  reset();
  const stock = store.addStock({
    name: "洁面",
    categoryName: "洁面",
    quantity: 1
  });

  store.deleteStock(stock.id);
  assert.equal(store.listStocks("stocked").length, 0);
}

function testUpdateUsageRecordKeepsRecordIdentity() {
  reset();
  const record = store.addUsageRecord({
    name: "早 C 精华",
    categoryName: "精华",
    amount: "1 泵",
    timeOfDay: "morning",
    date: "2026-06-07"
  });

  const updated = store.updateUsageRecord(record.id, {
    name: "晚 A 醇",
    categoryName: "乳霜",
    amount: "黄豆大小",
    timeOfDay: "evening",
    date: "2026-06-07"
  });
  assert.equal(updated.id, record.id);
  assert.equal(store.listTodayRecords("2026-06-07").length, 1);
  assert.equal(store.listTodayRecords("2026-06-07")[0].productNameSnapshot, "晚 A 醇");
  assert.equal(store.listTodayRecords("2026-06-07")[0].timeOfDay, "evening");
}

function testUpdateStockKeepsLifecycleState() {
  reset();
  const stock = store.addStock({
    name: "旧面霜",
    categoryName: "乳霜",
    capacity: "30ml",
    quantity: 1
  });
  store.updateStockStatus(stock.id, "active", "2026-06-07");
  const updated = store.updateStock(stock.id, {
    name: "新面霜",
    categoryName: "乳霜",
    capacity: "50ml",
    quantity: 2,
    expiryDate: "2026-12-31"
  });

  assert.equal(updated.status, "active");
  assert.equal(updated.openedDate, "2026-06-07");
  assert.equal(updated.productNameSnapshot, "新面霜");
  assert.equal(updated.capacitySnapshot, "50ml");
  assert.equal(updated.quantity, 2);
}

function testWeeklyStatsComparesPreviousWeek() {
  reset();
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-02" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-03" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-05-26" });
  store.addUsageRecord({ name: "面霜 B", categoryName: "乳霜", date: "2026-05-27" });

  const weekly = store.weeklyStats("2026-06-07", 1);
  const serum = weekly.find((item) => item.productName === "精华 A");
  const cream = weekly.find((item) => item.productName === "面霜 B");
  assert.equal(serum.count, 2);
  assert.equal(serum.previousCount, 1);
  assert.equal(cream.count, 0);
  assert.equal(cream.previousCount, 1);
}

function testWeeklyUsageMatrixUsesOneDotPerProductDay() {
  reset();
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-02", timeOfDay: "morning" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-02", timeOfDay: "evening" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-03", timeOfDay: "morning" });

  const matrix = store.weeklyUsageMatrix("2026-06-07", 1);
  const row = matrix.rows.find((item) => item.productName === "精华 A");
  assert.equal(matrix.days[0], "2026-06-01");
  assert.equal(row.total, 2);
  assert.equal(row.days["2026-06-02"], true);
  assert.equal(row.days["2026-06-03"], true);
}

function testInputValidationBoundaries() {
  reset();
  assert.throws(() => store.addCategory("   "), /分类名称不能为空/);
  assert.throws(() => store.addUsageRecord({ name: "   ", categoryName: "精华" }), /产品名称不能为空/);
  assert.equal(store.addStock({ name: "乳液", categoryName: "乳霜" }).quantity, 1);
  assert.throws(() => store.addStock({ name: "乳液", categoryName: "乳霜", quantity: 0 }), /数量需为 1 或以上整数/);
  assert.throws(() => store.addStock({ name: "乳液", categoryName: "乳霜", quantity: 1.5 }), /数量需为 1 或以上整数/);
  assert.throws(() => store.addStock({ name: "乳液", categoryName: "乳霜", quantity: 1, expiryDate: "2026/06/07" }), /日期格式需为 YYYY-MM-DD/);
  assert.throws(() => store.addStock({ name: "乳液", categoryName: "乳霜", quantity: 1, expiryDate: "2026-99-99" }), /日期不存在/);
}

function testInvalidStockTransitionsThrow() {
  reset();
  const stock = store.addStock({ name: "面霜", categoryName: "乳霜", quantity: 1 });
  assert.throws(() => store.updateStockStatus(stock.id, "finished", "2026-06-07"), /库存状态流转无效/);
  store.updateStockStatus(stock.id, "active", "2026-06-07");
  assert.equal(store.updateStockStatus(stock.id, "active", "2026-06-07").status, "active");
  store.updateStockStatus(stock.id, "finished", "2026-06-08");
  assert.equal(store.updateStockStatus(stock.id, "finished", "2026-06-08").status, "finished");
  assert.throws(() => store.updateStockStatus(stock.id, "active", "2026-06-09"), /库存状态流转无效/);
  assert.throws(() => store.updateStockStatus(stock.id, "archived"), /库存状态无效/);
}

function testQueryResultsAreCopies() {
  reset();
  const stock = store.addStock({ name: "喷雾", categoryName: "爽肤水", quantity: 1 });
  store.addUsageRecord({ name: "喷雾", categoryName: "爽肤水", date: "2026-06-07" });

  const categories = store.listCategories();
  categories.push({ id: "fake", name: "伪分类", sortOrder: 999 });
  categories[0].name = "被外部改名";
  assert.equal(store.listCategories().some((item) => item.name === "伪分类"), false);
  assert.notEqual(store.listCategories()[0].name, "被外部改名");

  const stocks = store.listStocks("stocked");
  stocks[0].status = "finished";
  assert.equal(store.listStocks("stocked").find((item) => item.id === stock.id).status, "stocked");

  const records = store.listTodayRecords("2026-06-07");
  records[0].productNameSnapshot = "被外部改名";
  assert.equal(store.listTodayRecords("2026-06-07")[0].productNameSnapshot, "喷雾");
}

function testDeleteEmptyCategoryOnly() {
  reset();
  const category = store.addCategory("身体护理");
  store.deleteCategory(category.id);
  assert.equal(store.listCategories().some((item) => item.id === category.id), false);

  const usedCategory = store.addCategory("特殊护理");
  store.addUsageRecord({ name: "修护霜", categoryName: "特殊护理", date: "2026-06-07" });
  assert.throws(() => store.deleteCategory(usedCategory.id), /分类已被产品使用，不能删除/);
  assert.equal(store.listCategories().some((item) => item.id === usedCategory.id), true);
}

function testDeleteCategoryKeepsAtLeastOneCategory() {
  reset();
  const categories = store.listCategories();
  categories.slice(1).forEach((category) => store.deleteCategory(category.id));
  const onlyCategory = store.listCategories()[0];
  assert.throws(() => store.deleteCategory(onlyCategory.id), /至少保留一个分类/);
  assert.equal(store.listCategories().length, 1);
}

function testCloudSyncDisabledByDefault() {
  reset();
  assert.equal(cloudConfig.enabled, false);
  store.addCategory("身体护理");
  assert.equal(store.cloudSyncStatus().pendingCloudSync, false);
}

function testExportAndImportSnapshot() {
  reset();
  store.addUsageRecord({
    name: "备份精华",
    categoryName: "精华",
    amount: "2 泵",
    date: "2026-06-07"
  });
  const snapshot = store.exportStoreSnapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.data.records.length, 1);

  store.resetStoreForTests();
  store.importStoreSnapshot(JSON.stringify(snapshot));
  assert.equal(store.listTodayRecords("2026-06-07")[0].productNameSnapshot, "备份精华");
  assert.equal(store.listCategories().some((item) => item.name === "精华"), true);
}

function testImportRejectsInvalidSnapshot() {
  reset();
  assert.throws(() => store.importStoreSnapshot("{}"), /分类 格式不正确/);
  assert.throws(() => store.importStoreSnapshot({ data: { categories: [], products: [], stocks: [], records: [] } }), /至少需要包含一个分类/);
}

function createMockWxCloud(initialDocs = []) {
  const storage = {};
  const docs = initialDocs.map((item, index) => ({ _id: item._id || `doc_${index}`, ...item }));
  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    getSystemInfoSync() {
      return { language: "zh-CN" };
    },
    cloud: {
      init() {},
      database() {
        return {
          collection() {
            return {
              where(query) {
                return {
                  limit() {
                    return {
                      async get() {
                        return { data: docs.filter((doc) => doc.storeKey === query.storeKey) };
                      }
                    };
                  }
                };
              },
              doc(id) {
                return {
                  async update({ data }) {
                    const index = docs.findIndex((doc) => doc._id === id);
                    docs[index] = { ...docs[index], ...data };
                    return { stats: { updated: 1 } };
                  }
                };
              },
              async add({ data }) {
                const doc = { _id: `doc_${docs.length}`, ...data };
                docs.push(doc);
                return { _id: doc._id };
              }
            };
          }
        };
      }
    }
  };
  return { docs, storage };
}

async function testLocalWritesMarkPendingAndFlushToCloud() {
  const mock = createMockWxCloud();
  cloudConfig.enabled = true;
  store.resetStoreForTests();
  store.ensureSeedData();
  assert.equal(store.cloudSyncStatus().pendingCloudSync, false);

  store.addCategory("身体护理");
  assert.equal(store.cloudSyncStatus().pendingCloudSync, true);

  const result = await store.flushCloudSync();
  assert.equal(result.synced, true);
  assert.equal(store.cloudSyncStatus().pendingCloudSync, false);
  assert.equal(mock.docs.length, 1);
  assert.equal(mock.docs[0].store.categories.some((item) => item.name === "身体护理"), true);
  delete global.wx;
  cloudConfig.enabled = false;
}

async function testRefreshFromCloudOverwritesLocalWhenNoPendingChange() {
  cloudConfig.enabled = true;
  createMockWxCloud([
    {
      storeKey: "default",
      updatedAt: "2026-06-07T00:00:00.000Z",
      store: {
        categories: [{ id: "cat_remote", name: "云端分类", sortOrder: 0 }],
        products: [],
        stocks: [],
        records: []
      }
    }
  ]);
  store.resetStoreForTests();
  store.ensureSeedData();
  assert.equal(store.cloudSyncStatus().pendingCloudSync, false);

  const result = await store.refreshFromCloud();
  assert.equal(result.updated, true);
  assert.deepEqual(store.listCategories().map((item) => item.name), ["云端分类"]);
  delete global.wx;
  cloudConfig.enabled = false;
}

testUsageRecordCreatesProductAndCategory();
testStockLifecycleAndDeleteBoundary();
testDeleteStockedItem();
testUpdateUsageRecordKeepsRecordIdentity();
testUpdateStockKeepsLifecycleState();
testWeeklyStatsComparesPreviousWeek();
testWeeklyUsageMatrixUsesOneDotPerProductDay();
testInputValidationBoundaries();
testInvalidStockTransitionsThrow();
testQueryResultsAreCopies();
testDeleteEmptyCategoryOnly();
testDeleteCategoryKeepsAtLeastOneCategory();
testCloudSyncDisabledByDefault();
testExportAndImportSnapshot();
testImportRejectsInvalidSnapshot();

async function runAsyncTests() {
  await testLocalWritesMarkPendingAndFlushToCloud();
  await testRefreshFromCloudOverwritesLocalWhenNoPendingChange();
}

runAsyncTests()
  .then(() => {
    console.log("wechat-miniprogram store tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

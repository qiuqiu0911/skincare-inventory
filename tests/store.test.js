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

function testOpenOneStockItemOnlySplitsQuantity() {
  reset();
  const stock = store.addStock({
    name: "囤货精华",
    categoryName: "精华",
    capacity: "30ml",
    quantity: 2
  });

  const activeStock = store.updateStockStatus(stock.id, "active", "2026-06-07");
  const stockedItems = store.listStocks("stocked");
  const activeItems = store.listStocks("active");
  assert.notEqual(activeStock.id, stock.id);
  assert.equal(activeStock.quantity, 1);
  assert.equal(activeStock.openedDate, "2026-06-07");
  assert.equal(stockedItems.length, 1);
  assert.equal(stockedItems[0].id, stock.id);
  assert.equal(stockedItems[0].quantity, 1);
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, activeStock.id);
}

function testOpeningSameProductFinishesPreviousActiveStock() {
  reset();
  const firstStock = store.addStock({
    name: "接续精华",
    categoryName: "精华",
    capacity: "30ml",
    quantity: 1
  });
  const firstActiveStock = store.updateStockStatus(firstStock.id, "active", "2026-06-07");
  const secondStock = store.addStock({
    name: "接续精华",
    categoryName: "精华",
    capacity: "30ml",
    quantity: 2
  });

  const secondActiveStock = store.updateStockStatus(secondStock.id, "active", "2026-06-08");
  const activeItems = store.listStocks("active");
  const finishedItems = store.listStocks("finished");
  const stockedItems = store.listStocks("stocked");

  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, secondActiveStock.id);
  assert.equal(finishedItems.length, 1);
  assert.equal(finishedItems[0].id, firstActiveStock.id);
  assert.equal(finishedItems[0].finishedDate, "2026-06-08");
  assert.equal(stockedItems.length, 1);
  assert.equal(stockedItems[0].id, secondStock.id);
  assert.equal(stockedItems[0].quantity, 1);
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

function testListTodayRecordsSortsByCreatedAt() {
  reset();
  store.importStoreSnapshot({
    data: {
      categories: [{ id: "cat_serum", name: "精华", sortOrder: 0 }],
      products: [],
      stocks: [],
      records: [
        {
          id: "usage_later",
          date: "2026-06-07",
          timeOfDay: "morning",
          productNameSnapshot: "后记录精华",
          categoryNameSnapshot: "精华",
          createdAt: "2026-06-07T08:30:00.000Z",
          updatedAt: "2026-06-07T08:30:00.000Z"
        },
        {
          id: "usage_earlier",
          date: "2026-06-07",
          timeOfDay: "morning",
          productNameSnapshot: "先记录精华",
          categoryNameSnapshot: "精华",
          createdAt: "2026-06-07T08:00:00.000Z",
          updatedAt: "2026-06-07T08:00:00.000Z"
        }
      ]
    }
  });

  assert.deepEqual(
    store.listTodayRecords("2026-06-07").map((record) => record.productNameSnapshot),
    ["先记录精华", "后记录精华"]
  );
}

function testReorderUsageRecordsPersistsDisplayOrder() {
  reset();
  const first = store.addUsageRecord({ name: "洁面", categoryName: "洁面", date: "2026-06-07", timeOfDay: "morning" });
  const second = store.addUsageRecord({ name: "精华", categoryName: "精华", date: "2026-06-07", timeOfDay: "morning" });
  const evening = store.addUsageRecord({ name: "晚霜", categoryName: "乳霜", date: "2026-06-07", timeOfDay: "evening" });

  store.reorderUsageRecords("2026-06-07", "morning", [second.id, first.id]);

  assert.deepEqual(
    store.listTodayRecords("2026-06-07")
      .filter((record) => record.timeOfDay === "morning")
      .map((record) => record.productNameSnapshot),
    ["精华", "洁面"]
  );
  assert.equal(store.listTodayRecords("2026-06-07").find((record) => record.id === evening.id).productNameSnapshot, "晚霜");
}

function testProductOptionsSortsAndFiltersByCategory() {
  reset();
  store.importStoreSnapshot({
    data: {
      categories: [
        { id: "cat_cleanser", name: "洁面", sortOrder: 0 },
        { id: "cat_serum", name: "精华", sortOrder: 1 }
      ],
      products: [
        { id: "prod_cleanser", name: "氨基酸洁面", categoryId: "cat_cleanser" },
        { id: "prod_serum", name: "B5 精华", categoryId: "cat_serum" }
      ],
      stocks: [
        {
          id: "stock_serum",
          productNameSnapshot: "A 醇精华",
          categoryNameSnapshot: "精华",
          status: "active",
          quantity: 1
        }
      ],
      records: [
        {
          id: "usage_serum",
          date: "2026-06-07",
          timeOfDay: "morning",
          productNameSnapshot: "C 光精华",
          categoryNameSnapshot: "精华",
          createdAt: "2026-06-07T08:00:00.000Z",
          updatedAt: "2026-06-07T08:00:00.000Z"
        }
      ]
    }
  });

  assert.deepEqual(store.productOptions("精华"), ["A 醇精华", "B5 精华", "C 光精华"]);
  assert.deepEqual(store.productOptions("洁面"), ["氨基酸洁面"]);
}

function testExistingProductNameKeepsSingleCategory() {
  reset();
  store.addUsageRecord({
    name: "芙清凉茶次抛",
    categoryName: "精华",
    date: "2026-06-07"
  });
  store.addUsageRecord({
    name: "芙清凉茶次抛",
    categoryName: "洁面",
    date: "2026-06-08"
  });

  const products = store.listProducts().filter((product) => product.name === "芙清凉茶次抛");
  assert.equal(products.length, 1);
  assert.equal(products[0].categoryName, "精华");
  assert.deepEqual(
    store.listTodayRecords("2026-06-08").map((record) => record.categoryNameSnapshot),
    ["精华"]
  );
}

function testUpdateProductCategoryMergesDuplicateProducts() {
  reset();
  store.importStoreSnapshot({
    data: {
      categories: [
        { id: "cat_cleanser", name: "洁面", sortOrder: 0 },
        { id: "cat_serum", name: "精华", sortOrder: 1 }
      ],
      products: [
        { id: "prod_serum", name: "芙清凉茶次抛", categoryId: "cat_serum" },
        { id: "prod_cleanser", name: "芙清凉茶次抛", categoryId: "cat_cleanser" }
      ],
      stocks: [
        {
          id: "stock_cleanser",
          productId: "prod_cleanser",
          productNameSnapshot: "芙清凉茶次抛",
          categoryNameSnapshot: "洁面",
          status: "stocked",
          quantity: 1
        }
      ],
      records: [
        {
          id: "usage_cleanser",
          date: "2026-06-15",
          timeOfDay: "morning",
          productId: "prod_cleanser",
          productNameSnapshot: "芙清凉茶次抛",
          categoryNameSnapshot: "洁面",
          createdAt: "2026-06-15T08:00:00.000Z",
          updatedAt: "2026-06-15T08:00:00.000Z"
        }
      ]
    }
  });

  store.updateProductCategory("prod_cleanser", "精华");

  const products = store.listProducts().filter((product) => product.name === "芙清凉茶次抛");
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "prod_serum");
  assert.equal(store.listTodayRecords("2026-06-15")[0].productId, "prod_serum");
  assert.equal(store.listTodayRecords("2026-06-15")[0].categoryNameSnapshot, "精华");
  assert.equal(store.listStocks("stocked")[0].productId, "prod_serum");
  assert.equal(store.listStocks("stocked")[0].categoryNameSnapshot, "精华");
}

function testResolveProductCategoryListsAndFixesConflicts() {
  reset();
  store.importStoreSnapshot({
    data: {
      categories: [
        { id: "cat_cleanser", name: "洁面", sortOrder: 0 },
        { id: "cat_serum", name: "精华", sortOrder: 1 }
      ],
      products: [
        { id: "prod_serum", name: "芙清凉茶次抛", categoryId: "cat_serum" },
        { id: "prod_cleanser", name: "芙清凉茶次抛", categoryId: "cat_cleanser" }
      ],
      stocks: [],
      records: [
        {
          id: "usage_serum",
          date: "2026-06-07",
          timeOfDay: "evening",
          productId: "prod_serum",
          productNameSnapshot: "芙清凉茶次抛",
          categoryNameSnapshot: "精华",
          createdAt: "2026-06-07T08:00:00.000Z",
          updatedAt: "2026-06-07T08:00:00.000Z"
        },
        {
          id: "usage_cleanser",
          date: "2026-06-15",
          timeOfDay: "morning",
          productId: "prod_cleanser",
          productNameSnapshot: "芙清凉茶次抛",
          categoryNameSnapshot: "洁面",
          createdAt: "2026-06-15T08:00:00.000Z",
          updatedAt: "2026-06-15T08:00:00.000Z"
        }
      ]
    }
  });

  assert.deepEqual(store.listProductCategoryConflicts().map((item) => item.name), ["芙清凉茶次抛"]);

  store.resolveProductCategory("芙清凉茶次抛", "精华");

  assert.equal(store.listProductCategoryConflicts().length, 0);
  assert.equal(store.listProducts().filter((product) => product.name === "芙清凉茶次抛").length, 1);
  assert.equal(store.listTodayRecords("2026-06-15")[0].categoryNameSnapshot, "精华");
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

function testWeeklyUsageMatrixTracksMorningAndEvening() {
  reset();
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-02", timeOfDay: "morning" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-02", timeOfDay: "evening" });
  store.addUsageRecord({ name: "精华 A", categoryName: "精华", date: "2026-06-03", timeOfDay: "morning" });

  const matrix = store.weeklyUsageMatrix("2026-06-07", 1);
  const row = matrix.rows.find((item) => item.productName === "精华 A");
  assert.equal(matrix.days[0], "2026-06-01");
  assert.equal(row.total, 2);
  assert.deepEqual(row.days["2026-06-02"], { morning: true, evening: true });
  assert.deepEqual(row.days["2026-06-03"], { morning: true, evening: false });
}

function testMonthlyUsageCalendarSummarizesRecords() {
  reset();
  store.addUsageRecord({
    name: "精华 A",
    categoryName: "精华",
    date: "2026-06-02",
    timeOfDay: "morning"
  });
  store.addUsageRecord({
    name: "精华 A",
    categoryName: "精华",
    date: "2026-06-02",
    timeOfDay: "evening"
  });
  store.addUsageRecord({
    name: "面霜 B",
    categoryName: "乳霜",
    date: "2026-06-15",
    timeOfDay: "evening"
  });
  store.addUsageRecord({
    name: "防晒 C",
    categoryName: "防晒",
    date: "2026-07-01",
    timeOfDay: "morning"
  });

  const calendar = store.monthlyUsageCalendar("2026-06-15", "2026-06-02", 1);
  const selectedDay = calendar.cells.find((item) => item.date === "2026-06-02");
  const paddedCalendar = store.monthlyUsageCalendar("2026-08-01", "2026-08-01", 1);

  assert.equal(calendar.monthKey, "2026-06");
  assert.equal(calendar.cells.length, 35);
  assert.equal(calendar.weeks.length, 5);
  assert.equal(calendar.recordCount, 3);
  assert.equal(calendar.usedDayCount, 2);
  assert.equal(calendar.productCount, 2);
  assert.equal(selectedDay.isSelected, true);
  assert.equal(selectedDay.recordCount, 2);
  assert.equal(selectedDay.productCount, 1);
  assert.equal(selectedDay.morning, true);
  assert.equal(selectedDay.evening, true);
  assert.equal(paddedCalendar.cells[0].inMonth, false);
  assert.equal(paddedCalendar.cells[5].date, "2026-08-01");
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
testOpenOneStockItemOnlySplitsQuantity();
testOpeningSameProductFinishesPreviousActiveStock();
testDeleteStockedItem();
testUpdateUsageRecordKeepsRecordIdentity();
testListTodayRecordsSortsByCreatedAt();
testReorderUsageRecordsPersistsDisplayOrder();
testProductOptionsSortsAndFiltersByCategory();
testExistingProductNameKeepsSingleCategory();
testUpdateProductCategoryMergesDuplicateProducts();
testResolveProductCategoryListsAndFixesConflicts();
testUpdateStockKeepsLifecycleState();
testWeeklyStatsComparesPreviousWeek();
testWeeklyUsageMatrixTracksMorningAndEvening();
testMonthlyUsageCalendarSummarizesRecords();
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

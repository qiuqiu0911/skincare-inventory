const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

function trim(value) {
  return String(value || "").trim();
}

function backupFileName() {
  const date = store.todayKey().replace(/-/g, "");
  return `cosmetics-tracker-backup-${date}.json`;
}

function previewNames(items, fallback) {
  const names = items.map((item) => item.name).filter(Boolean);
  return names.length ? names.slice(0, 4).join("、") : fallback;
}

Page({
  data: {
    templateCount: 0,
    templatePreviewText: "还没有模板",
    categoryCount: 0,
    categoryPreviewText: "还没有分类",
    productCount: 0,
    productConflictCount: 0,
    productSummaryText: "还没有产品"
  },

  onShow() {
    this.refresh();
    this.syncFromCloud();
  },

  syncFromCloud() {
    if (!cloudConfig.enabled) {
      return;
    }
    store.flushCloudSync()
      .then(() => store.refreshFromCloud())
      .then((result) => {
        if (result && result.updated) {
          this.refresh();
        }
      })
      .catch(() => {});
  },

  refresh() {
    try {
      const templates = store.listUsageTemplates();
      const categories = store.listCategories();
      const products = store.listProducts();
      const productConflicts = store.listProductCategoryConflicts();
      const productSummaryText = productConflicts.length
        ? `${products.length} 个产品 · ${productConflicts.length} 个冲突待处理`
        : `${products.length} 个产品`;

      this.setData({
        templateCount: templates.length,
        templatePreviewText: previewNames(templates, "还没有模板"),
        categoryCount: categories.length,
        categoryPreviewText: previewNames(categories, "还没有分类"),
        productCount: products.length,
        productConflictCount: productConflicts.length,
        productSummaryText
      });
    } catch (error) {
      this.setData({
        templateCount: 0,
        templatePreviewText: "读取模板失败",
        categoryCount: 0,
        categoryPreviewText: "读取分类失败",
        productCount: 0,
        productConflictCount: 0,
        productSummaryText: "读取产品失败"
      });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  goTemplates() {
    wx.navigateTo({ url: "/pages/templates/templates" });
  },

  goCategories() {
    wx.navigateTo({ url: "/pages/categories/categories" });
  },

  exportData() {
    try {
      const filePath = `${wx.env.USER_DATA_PATH}/${backupFileName()}`;
      const fileContent = JSON.stringify(store.exportStoreSnapshot(), null, 2);
      wx.getFileSystemManager().writeFileSync(filePath, fileContent, "utf8");
      if (typeof wx.shareFileMessage === "function") {
        wx.shareFileMessage({
          filePath,
          fileName: backupFileName(),
          success: () => {
            wx.showToast({ title: "已生成备份", icon: "success" });
          },
          fail: () => {
            wx.showModal({
              title: "备份已生成",
              content: `文件已保存到小程序本地路径：${filePath}`,
              showCancel: false
            });
          }
        });
        return;
      }
      wx.showModal({
        title: "备份已生成",
        content: `文件已保存到小程序本地路径：${filePath}`,
        showCancel: false
      });
    } catch (error) {
      wx.showToast({ title: error.message || "导出失败", icon: "none" });
    }
  },

  importData() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["json"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.path) {
          wx.showToast({ title: "未选择文件", icon: "none" });
          return;
        }
        this.confirmImport(() => this.readAndImportFile(file.path));
      }
    });
  },

  importClipboardData() {
    wx.getClipboardData({
      success: (result) => {
        const content = trim(result.data);
        if (!content) {
          wx.showToast({ title: "剪贴板没有 JSON", icon: "none" });
          return;
        }
        this.confirmImport(() => this.importSnapshotContent(content));
      },
      fail: () => {
        wx.showToast({ title: "读取剪贴板失败", icon: "none" });
      }
    });
  },

  confirmImport(onConfirm) {
    wx.showModal({
      title: "导入并覆盖当前数据？",
      content: "导入后会替换当前本机记录、库存、分类和模板。建议先导出当前数据备份。",
      confirmText: "确认导入",
      confirmColor: "#111827",
      success: (modalResult) => {
        if (!modalResult.confirm) {
          return;
        }
        onConfirm();
      }
    });
  },

  readAndImportFile(filePath) {
    try {
      const fileContent = wx.getFileSystemManager().readFileSync(filePath, "utf8");
      this.importSnapshotContent(fileContent);
    } catch (error) {
      wx.showToast({ title: error.message || "导入失败", icon: "none" });
    }
  },

  importSnapshotContent(fileContent) {
    try {
      store.importStoreSnapshot(fileContent);
      this.refresh();
      wx.showToast({ title: "导入成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "导入失败", icon: "none" });
    }
  }
});

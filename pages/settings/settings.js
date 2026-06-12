const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

function trim(value) {
  return String(value || "").trim();
}

function validateCategoryName(value) {
  if (!trim(value)) {
    return "请填写分类名称";
  }
  if (trim(value).length > 12) {
    return "分类名称请控制在 12 字以内";
  }
  return "";
}

function hasCategory(categories, name) {
  const categoryName = trim(name);
  return categories.some((category) => category.name === categoryName);
}

function backupFileName() {
  const date = store.todayKey().replace(/-/g, "");
  return `cosmetics-tracker-backup-${date}.json`;
}

Page({
  data: {
    categories: [],
    categoryName: "",
    categoryError: "",
    submitting: false,
    deletingCategoryId: "",
    swipedCategoryId: "",
    canSubmit: false
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
      this.setData({
        categories: store.listCategories().map((category) => ({
          ...category,
          swiped: category.id === this.data.swipedCategoryId
        }))
      });
    } catch (error) {
      this.setData({ categories: [] });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  onCategoryTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.categoryTouchStartX = touch.clientX;
    this.categoryTouchStartY = touch.clientY;
  },

  onCategoryTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.categoryTouchStartX === undefined) {
      return;
    }
    const deltaX = touch.clientX - this.categoryTouchStartX;
    const deltaY = touch.clientY - this.categoryTouchStartY;
    const id = event.currentTarget.dataset.id;

    this.categoryTouchStartX = undefined;
    this.categoryTouchStartY = undefined;

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    if (deltaX < -45) {
      this.setData({ swipedCategoryId: id });
      this.refresh();
      return;
    }
    if (deltaX > 30 || this.data.swipedCategoryId) {
      this.setData({ swipedCategoryId: "" });
      this.refresh();
    }
  },

  closeCategorySwipe() {
    if (!this.data.swipedCategoryId) {
      return;
    }
    this.setData({ swipedCategoryId: "" });
    this.refresh();
  },

  onCategoryInput(event) {
    const categoryName = event.detail.value;
    const validationMessage = validateCategoryName(categoryName) || (hasCategory(this.data.categories, categoryName) ? "该分类已存在" : "");
    const categoryError = this.data.categoryError ? validationMessage : "";
    this.setData({
      categoryName,
      categoryError,
      canSubmit: !this.data.submitting && !validationMessage
    });
  },

  clearCategoryName() {
    this.setData({
      categoryName: "",
      categoryError: "",
      canSubmit: false
    });
  },

  addCategory() {
    if (this.data.submitting || !this.data.canSubmit) {
      return;
    }
    const categoryError = validateCategoryName(this.data.categoryName) || (hasCategory(this.data.categories, this.data.categoryName) ? "该分类已存在" : "");
    if (categoryError) {
      this.setData({ categoryError, canSubmit: false });
      wx.showToast({ title: categoryError, icon: "none" });
      return;
    }

    this.setData({ submitting: true, canSubmit: false });
    try {
      store.addCategory(this.data.categoryName);
      this.setData({ categoryName: "", categoryError: "" });
      this.refresh();
      wx.showToast({ title: "已保存分类", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      const categoryError = validateCategoryName(this.data.categoryName);
      this.setData({
        submitting: false,
        canSubmit: !categoryError
      });
    }
  },

  deleteCategory(event) {
    if (this.data.deletingCategoryId) {
      return;
    }
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name;
    wx.showModal({
      title: "删除这个分类？",
      content: `仅未被产品使用的空分类可删除。确认删除“${name}”？`,
      confirmText: "删除",
      confirmColor: "#FF3B30",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        this.setData({ deletingCategoryId: id });
        try {
          store.deleteCategory(id);
          this.setData({ swipedCategoryId: "" });
          this.refresh();
          wx.showToast({ title: "已删除分类", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        } finally {
          this.setData({ deletingCategoryId: "" });
        }
      }
    });
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
        wx.showModal({
          title: "导入并覆盖当前数据？",
          content: "导入后会替换当前本机记录、库存和分类。建议先导出当前数据备份。",
          confirmText: "确认导入",
          confirmColor: "#111827",
          success: (modalResult) => {
            if (!modalResult.confirm) {
              return;
            }
            this.readAndImportFile(file.path);
          }
        });
      }
    });
  },

  readAndImportFile(filePath) {
    try {
      const fileContent = wx.getFileSystemManager().readFileSync(filePath, "utf8");
      store.importStoreSnapshot(fileContent);
      this.setData({ categoryName: "", categoryError: "", canSubmit: false });
      this.refresh();
      wx.showToast({ title: "导入成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "导入失败", icon: "none" });
    }
  }
});

const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const TEMPLATE_TIME_OPTIONS = [
  { label: "早间", value: "morning" },
  { label: "晚间", value: "evening" }
];
const MAX_TEMPLATE_NAME_LENGTH = 20;
const MAX_TEMPLATE_AMOUNT_LENGTH = 30;

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

function filterProductOptions(options, keyword) {
  const query = trim(keyword).toLowerCase();
  if (!query) {
    return options;
  }
  return options.filter((name) => String(name || "").toLowerCase().includes(query));
}

function backupFileName() {
  const date = store.todayKey().replace(/-/g, "");
  return `cosmetics-tracker-backup-${date}.json`;
}

function timeText(timeOfDay) {
  return timeOfDay === "evening" ? "晚间" : "早间";
}

function emptyTemplateItem(categoryName = "洁面") {
  return {
    productName: "",
    categoryName,
    amount: "",
    categoryIndex: 0
  };
}

function emptyTemplateForm(categoryName = "洁面") {
  return {
    name: "",
    timeOfDay: "morning",
    items: [emptyTemplateItem(categoryName)]
  };
}

function validateTemplateForm(form) {
  if (!trim(form.name)) {
    return "请填写模板名称";
  }
  if (trim(form.name).length > MAX_TEMPLATE_NAME_LENGTH) {
    return `模板名称请控制在 ${MAX_TEMPLATE_NAME_LENGTH} 字以内`;
  }
  const validItems = (form.items || []).filter((item) => trim(item.productName));
  if (!validItems.length) {
    return "模板至少需要一个产品";
  }
  if (validItems.some((item) => trim(item.amount).length > MAX_TEMPLATE_AMOUNT_LENGTH)) {
    return `模板用量请控制在 ${MAX_TEMPLATE_AMOUNT_LENGTH} 字以内`;
  }
  return "";
}

Page({
  data: {
    categories: [],
    categoryNames: [],
    categoryName: "",
    categoryError: "",
    products: [],
    templates: [],
    templateTimeOptions: TEMPLATE_TIME_OPTIONS,
    templateForm: emptyTemplateForm(),
    templateError: "",
    editingTemplateId: "",
    showTemplateForm: false,
    showTemplateProductSelector: false,
    templateProductSelectorIndex: -1,
    templateProductSearchKeyword: "",
    templateProductOptions: [],
    filteredTemplateProductOptions: [],
    canSubmitTemplate: false,
    productConflicts: [],
    productManagerCategoryName: "",
    productManagerProducts: [],
    productManagerTitle: "",
    showProductManager: false,
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
      const categories = store.listCategories();
      const categoryNames = categories.map((category) => category.name);
      const products = store.listProducts();
      const templates = store.listUsageTemplates().map((template) => ({
        ...template,
        timeText: timeText(template.timeOfDay)
      }));
      const productConflicts = store.listProductCategoryConflicts().map((conflict) => ({
        ...conflict,
        categoryText: conflict.categoryNames.join(" / "),
        categoryIndex: Math.max(0, categoryNames.indexOf(conflict.categoryNames[0]))
      }));
      const productManagerProducts = this.data.productManagerCategoryName
        ? products
          .filter((product) => product.categoryName === this.data.productManagerCategoryName)
          .map((product) => ({
            ...product,
            categoryIndex: Math.max(0, categoryNames.indexOf(product.categoryName))
          }))
        : [];
      this.setData({
        categories: categories.map((category) => ({
          ...category,
          swiped: category.id === this.data.swipedCategoryId
        })),
        categoryNames,
        products,
        templates,
        productConflicts,
        productManagerProducts,
        productManagerTitle: this.data.productManagerCategoryName
          ? `${this.data.productManagerCategoryName}产品`
          : "产品分类"
      });
    } catch (error) {
      this.setData({
        categories: [],
        categoryNames: [],
        products: [],
        templates: [],
        productConflicts: [],
        productManagerProducts: []
      });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  setTemplateForm(nextForm, templateError = this.data.templateError) {
    const categoryNames = this.data.categoryNames.length ? this.data.categoryNames : ["未分类"];
    const templateForm = {
      ...nextForm,
      items: (nextForm.items || []).map((item) => ({
        ...item,
        categoryName: item.categoryName || categoryNames[0],
        categoryIndex: Math.max(0, categoryNames.indexOf(item.categoryName || categoryNames[0]))
      }))
    };
    const validationMessage = validateTemplateForm(templateForm);
    this.setData({
      templateForm,
      templateError,
      canSubmitTemplate: !validationMessage
    });
  },

  openCreateTemplateForm() {
    const categoryName = this.data.categoryNames[0] || "未分类";
    this.setData({
      showTemplateForm: true,
      editingTemplateId: "",
      templateError: "",
      showTemplateProductSelector: false
    });
    this.setTemplateForm(emptyTemplateForm(categoryName), "");
  },

  editTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.templates.find((item) => item.id === id);
    if (!template) {
      return;
    }
    this.setData({
      showTemplateForm: true,
      editingTemplateId: id,
      templateError: "",
      showTemplateProductSelector: false
    });
    this.setTemplateForm({
      name: template.name,
      timeOfDay: template.timeOfDay,
      items: template.items.map((item) => ({
        productName: item.productName,
        categoryName: item.categoryName,
        amount: item.amount
      }))
    }, "");
  },

  closeTemplateForm() {
    this.setData({
      showTemplateForm: false,
      editingTemplateId: "",
      templateError: "",
      showTemplateProductSelector: false,
      templateProductSelectorIndex: -1,
      templateProductSearchKeyword: "",
      templateProductOptions: [],
      filteredTemplateProductOptions: [],
      canSubmitTemplate: false
    });
  },

  switchTemplateTime(event) {
    this.setTemplateForm({
      ...this.data.templateForm,
      timeOfDay: event.currentTarget.dataset.value
    }, "");
  },

  onTemplateNameInput(event) {
    this.setTemplateForm({
      ...this.data.templateForm,
      name: event.detail.value
    }, "");
  },

  onTemplateItemInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    this.setTemplateForm({
      ...this.data.templateForm,
      items: this.data.templateForm.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: event.detail.value } : item
      ))
    }, "");
  },

  onTemplateItemCategoryPick(event) {
    const index = Number(event.currentTarget.dataset.index);
    const categoryName = this.data.categoryNames[Number(event.detail.value)] || "未分类";
    const productOptions = store.productOptions(categoryName);
    this.setTemplateForm({
      ...this.data.templateForm,
      items: this.data.templateForm.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, categoryName } : item
      ))
    }, "");
    if (this.data.showTemplateProductSelector && this.data.templateProductSelectorIndex === index) {
      this.setData({
        templateProductOptions: productOptions,
        filteredTemplateProductOptions: filterProductOptions(productOptions, this.data.templateProductSearchKeyword)
      });
    }
  },

  addTemplateItem() {
    const categoryName = this.data.categoryNames[0] || "未分类";
    this.setTemplateForm({
      ...this.data.templateForm,
      items: [...this.data.templateForm.items, emptyTemplateItem(categoryName)]
    }, "");
  },

  removeTemplateItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const items = this.data.templateForm.items.filter((item, itemIndex) => itemIndex !== index);
    const nextSelectorIndex = this.data.templateProductSelectorIndex > index
      ? this.data.templateProductSelectorIndex - 1
      : this.data.templateProductSelectorIndex;
    this.setTemplateForm({
      ...this.data.templateForm,
      items: items.length ? items : [emptyTemplateItem(this.data.categoryNames[0] || "未分类")]
    }, "");
    this.setData({
      showTemplateProductSelector: this.data.templateProductSelectorIndex !== index
        && this.data.showTemplateProductSelector,
      templateProductSelectorIndex: this.data.templateProductSelectorIndex === index ? -1 : nextSelectorIndex
    });
  },

  openTemplateProductSelector(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.templateForm.items[index];
    if (!item) {
      return;
    }
    const productOptions = store.productOptions(item.categoryName);
    this.setData({
      showTemplateProductSelector: true,
      templateProductSelectorIndex: index,
      templateProductSearchKeyword: "",
      templateProductOptions: productOptions,
      filteredTemplateProductOptions: productOptions
    });
  },

  closeTemplateProductSelector() {
    this.setData({
      showTemplateProductSelector: false,
      templateProductSelectorIndex: -1,
      templateProductSearchKeyword: "",
      templateProductOptions: [],
      filteredTemplateProductOptions: []
    });
  },

  onTemplateProductSearchInput(event) {
    const templateProductSearchKeyword = event.detail.value;
    this.setData({
      templateProductSearchKeyword,
      filteredTemplateProductOptions: filterProductOptions(
        this.data.templateProductOptions,
        templateProductSearchKeyword
      )
    });
  },

  selectTemplateProduct(event) {
    const productName = event.currentTarget.dataset.name;
    const index = this.data.templateProductSelectorIndex;
    if (!productName || index < 0) {
      return;
    }
    this.setTemplateForm({
      ...this.data.templateForm,
      items: this.data.templateForm.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, productName } : item
      ))
    }, "");
    this.closeTemplateProductSelector();
  },

  submitTemplateForm() {
    const templateError = validateTemplateForm(this.data.templateForm);
    if (templateError) {
      this.setData({ templateError, canSubmitTemplate: false });
      wx.showToast({ title: templateError, icon: "none" });
      return;
    }
    const payload = {
      name: this.data.templateForm.name,
      timeOfDay: this.data.templateForm.timeOfDay,
      items: this.data.templateForm.items
        .filter((item) => trim(item.productName))
        .map((item) => ({
          productName: item.productName,
          categoryName: item.categoryName,
          amount: item.amount
        }))
    };
    try {
      if (this.data.editingTemplateId) {
        store.updateUsageTemplate(this.data.editingTemplateId, payload);
      } else {
        store.addUsageTemplate(payload);
      }
      this.closeTemplateForm();
      this.refresh();
      wx.showToast({ title: "已保存模板", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    }
  },

  deleteTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name;
    wx.showModal({
      title: "删除这个模板？",
      content: `确认删除“${name}”？`,
      confirmText: "删除",
      confirmColor: "#FF3B30",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        try {
          store.deleteUsageTemplate(id);
          this.refresh();
          wx.showToast({ title: "已删除模板", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
        }
      }
    });
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

  openProductManager(event) {
    const categoryName = event.currentTarget.dataset.name;
    this.setData({
      productManagerCategoryName: categoryName,
      showProductManager: true,
      swipedCategoryId: ""
    });
    this.refresh();
  },

  closeProductManager() {
    this.setData({
      productManagerCategoryName: "",
      productManagerProducts: [],
      showProductManager: false
    });
  },

  noop() {},

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

  onProductCategoryPick(event) {
    const id = event.currentTarget.dataset.id;
    const productName = event.currentTarget.dataset.name;
    const categoryName = this.data.categoryNames[Number(event.detail.value)];
    const product = this.data.products.find((item) => item.id === id);
    if (!id || !categoryName || !product || product.categoryName === categoryName) {
      return;
    }
    wx.showModal({
      title: "调整产品分类？",
      content: `将“${productName}”归到“${categoryName}”，并同步更新关联记录和库存。`,
      confirmText: "调整",
      confirmColor: "#111827",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        try {
          store.updateProductCategory(id, categoryName);
          this.refresh();
          wx.showToast({ title: "已调整分类", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "调整失败", icon: "none" });
        }
      }
    });
  },

  onConflictCategoryPick(event) {
    const productName = event.currentTarget.dataset.name;
    const categoryName = this.data.categoryNames[Number(event.detail.value)];
    if (!productName || !categoryName) {
      return;
    }
    wx.showModal({
      title: "选择唯一分类？",
      content: `将“${productName}”统一归到“${categoryName}”，并同步更新历史记录和库存。`,
      confirmText: "统一",
      confirmColor: "#111827",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        try {
          store.resolveProductCategory(productName, categoryName);
          this.refresh();
          wx.showToast({ title: "已统一分类", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "处理失败", icon: "none" });
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
      content: "导入后会替换当前本机记录、库存和分类。建议先导出当前数据备份。",
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
      this.setData({
        categoryName: "",
        categoryError: "",
        templateError: "",
        showTemplateForm: false,
        editingTemplateId: "",
        canSubmit: false,
        canSubmitTemplate: false
      });
      this.refresh();
      wx.showToast({ title: "导入成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "导入失败", icon: "none" });
    }
  }
});

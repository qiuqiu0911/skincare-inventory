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

function filterProductOptions(options, keyword) {
  const query = trim(keyword).toLowerCase();
  if (!query) {
    return options;
  }
  return options.filter((name) => String(name || "").toLowerCase().includes(query));
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
    categoryNames: [],
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
    canSubmitTemplate: false
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
      const templates = store.listUsageTemplates().map((template) => ({
        ...template,
        timeText: timeText(template.timeOfDay)
      }));
      this.setData({
        categoryNames,
        templates
      });
    } catch (error) {
      this.setData({
        categoryNames: [],
        templates: []
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

  noop() {}
});

const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const TIME_OPTIONS = [
  { label: "早间", fullLabel: "早间护肤", value: "morning", icon: "☀" },
  { label: "晚间", fullLabel: "晚间护肤", value: "evening", icon: "☾" }
];
const MAX_AMOUNT_LENGTH = 30;

function trim(value) {
  return String(value || "").trim();
}

function emptyForm(timeOfDay) {
  return {
    productName: "",
    categoryName: "洁面",
    amount: "",
    timeOfDay
  };
}

function validateRecordForm(form) {
  const errors = {};
  if (!trim(form.productName)) {
    errors.productName = "请填写产品名称";
  }
  if (!trim(form.categoryName)) {
    errors.categoryName = "请选择分类";
  }
  if (trim(form.amount).length > MAX_AMOUNT_LENGTH) {
    errors.amount = `用量描述请控制在 ${MAX_AMOUNT_LENGTH} 字以内`;
  }
  return errors;
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

function canSubmitRecord(form, submitting) {
  return !submitting && !hasErrors(validateRecordForm(form));
}

Page({
  data: {
    today: "",
    categories: [],
    productOptions: [],
    records: [],
    activeRecords: [],
    timeOptions: TIME_OPTIONS,
    activeTime: "morning",
    categoryIndex: 0,
    submitting: false,
    showForm: false,
    editingId: "",
    formErrors: {},
    canSubmit: false,
    form: emptyForm("morning")
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

  setForm(nextForm, nextErrors = this.data.formErrors) {
    this.setData({
      form: nextForm,
      formErrors: nextErrors,
      categoryIndex: Math.max(0, this.data.categories.indexOf(nextForm.categoryName)),
      canSubmit: canSubmitRecord(nextForm, this.data.submitting)
    });
  },

  refresh() {
    try {
      const categories = store.listCategories().map((item) => item.name);
      const categoryName = this.data.form.categoryName || categories[0] || "未分类";
      const form = {
        ...this.data.form,
        categoryName
      };
      const records = store.listTodayRecords();
      this.setData({
        today: store.todayKey(),
        categories,
        productOptions: store.productOptions(),
        records,
        activeRecords: records.filter((record) => record.timeOfDay === this.data.activeTime),
        categoryIndex: Math.max(0, categories.indexOf(categoryName)),
        form,
        canSubmit: canSubmitRecord(form, this.data.submitting)
      });
    } catch (error) {
      this.setData({ categories: [], productOptions: [], records: [], activeRecords: [] });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  switchTime(event) {
    const activeTime = event.currentTarget.dataset.value;
    this.setData({
      activeTime,
      activeRecords: this.data.records.filter((record) => record.timeOfDay === activeTime)
    });
  },

  switchFormTime(event) {
    const timeOfDay = event.currentTarget.dataset.value;
    this.setForm({ ...this.data.form, timeOfDay });
  },

  openCreateForm() {
    const categoryName = this.data.categories[0] || "未分类";
    this.setData({
      showForm: true,
      editingId: "",
      formErrors: {}
    });
    this.setForm({
      ...emptyForm(this.data.activeTime),
      categoryName
    });
  },

  closeForm() {
    this.setData({
      showForm: false,
      editingId: "",
      formErrors: {},
      submitting: false
    });
  },

  editRecord(event) {
    const id = event.currentTarget.dataset.id;
    const record = this.data.records.find((item) => item.id === id);
    if (!record) {
      return;
    }
    this.setData({
      showForm: true,
      editingId: id,
      formErrors: {}
    });
    this.setForm({
      productName: record.productNameSnapshot,
      categoryName: record.categoryNameSnapshot,
      amount: record.amount,
      timeOfDay: record.timeOfDay
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setForm({
      ...this.data.form,
      [field]: event.detail.value
    }, {
      ...this.data.formErrors,
      [field]: ""
    });
  },

  onProductPick(event) {
    const productName = this.data.productOptions[Number(event.detail.value)];
    this.setForm({
      ...this.data.form,
      productName
    }, {
      ...this.data.formErrors,
      productName: ""
    });
  },

  onCategoryPick(event) {
    const index = Number(event.detail.value);
    this.setForm({
      ...this.data.form,
      categoryName: this.data.categories[index]
    }, {
      ...this.data.formErrors,
      categoryName: ""
    });
  },

  submitRecord() {
    if (this.data.submitting) {
      return;
    }
    const formErrors = validateRecordForm(this.data.form);
    if (hasErrors(formErrors)) {
      this.setData({ formErrors, canSubmit: false });
      wx.showToast({ title: formErrors.productName || formErrors.categoryName || formErrors.amount, icon: "none" });
      return;
    }

    this.setData({ submitting: true, canSubmit: false });
    try {
      const payload = {
        name: this.data.form.productName,
        categoryName: this.data.form.categoryName,
        amount: this.data.form.amount,
        timeOfDay: this.data.form.timeOfDay,
        date: store.todayKey()
      };
      if (this.data.editingId) {
        store.updateUsageRecord(this.data.editingId, payload);
        this.closeForm();
      } else {
        store.addUsageRecord(payload);
        this.setForm({
          ...this.data.form,
          productName: "",
          amount: ""
        }, {});
      }
      this.refresh();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({
        submitting: false,
        canSubmit: canSubmitRecord(this.data.form, false)
      });
    }
  },

  deleteRecord(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这条记录？",
      content: "删除后，今天和回看统计会同步更新。",
      confirmText: "删除",
      confirmColor: "#FF3B30",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        try {
          store.deleteUsageRecord(id);
          this.refresh();
          wx.showToast({ title: "已删除", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  }
});

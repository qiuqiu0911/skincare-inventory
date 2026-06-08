const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const TIME_OPTIONS = [
  { label: "早间", fullLabel: "早间护肤", value: "morning" },
  { label: "晚间", fullLabel: "晚间护肤", value: "evening" }
];
const MAX_AMOUNT_LENGTH = 30;
const DEFAULT_TIME_OF_DAY = defaultTimeOfDay();

function trim(value) {
  return String(value || "").trim();
}

function emptyForm(timeOfDay) {
  return {
    productName: "",
    categoryName: "洁面",
    amount: "",
    timeOfDay,
    date: store.todayKey()
  };
}

function defaultTimeOfDay(date = new Date()) {
  return date.getHours() < 12 ? "morning" : "evening";
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
    activeTime: DEFAULT_TIME_OF_DAY,
    categoryIndex: 0,
    submitting: false,
    swipedRecordId: "",
    showForm: false,
    editingId: "",
    formErrors: {},
    canSubmit: false,
    form: emptyForm(DEFAULT_TIME_OF_DAY)
  },

  onLoad(options = {}) {
    if (options.date) {
      this.pendingRecordDate = options.date;
    }
  },

  onShow() {
    if (!this.hasManualTimeSelection && !this.data.showForm) {
      const activeTime = defaultTimeOfDay();
      if (activeTime !== this.data.activeTime) {
        this.setData({
          activeTime,
          swipedRecordId: "",
          form: {
            ...this.data.form,
            timeOfDay: activeTime
          }
        });
      }
    }
    this.refresh();
    if (this.pendingRecordDate) {
      this.openCreateForm({ date: this.pendingRecordDate });
      this.pendingRecordDate = "";
    }
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
        activeRecords: records
          .filter((record) => record.timeOfDay === this.data.activeTime)
          .map((record) => ({
            ...record,
            swiped: record.id === this.data.swipedRecordId
          })),
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
    this.hasManualTimeSelection = true;
    this.setData({
      activeTime,
      swipedRecordId: "",
      activeRecords: this.data.records
        .filter((record) => record.timeOfDay === activeTime)
        .map((record) => ({ ...record, swiped: false }))
    });
  },

  onRecordTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.recordTouchStartX = touch.clientX;
    this.recordTouchStartY = touch.clientY;
  },

  onRecordTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.recordTouchStartX === undefined) {
      return;
    }
    const deltaX = touch.clientX - this.recordTouchStartX;
    const deltaY = touch.clientY - this.recordTouchStartY;
    const id = event.currentTarget.dataset.id;

    this.recordTouchStartX = undefined;
    this.recordTouchStartY = undefined;

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    if (deltaX < -45) {
      this.setData({ swipedRecordId: id });
      this.refresh();
      return;
    }
    if (deltaX > 30 || this.data.swipedRecordId) {
      this.setData({ swipedRecordId: "" });
      this.refresh();
    }
  },

  closeRecordSwipe() {
    if (!this.data.swipedRecordId) {
      return;
    }
    this.setData({ swipedRecordId: "" });
    this.refresh();
  },

  switchFormTime(event) {
    const timeOfDay = event.currentTarget.dataset.value;
    this.hasManualTimeSelection = true;
    this.setForm({ ...this.data.form, timeOfDay });
  },

  openCreateForm(options = {}) {
    const categoryName = this.data.categories[0] || "未分类";
    const date = options.date || (options.currentTarget && options.currentTarget.dataset.date) || store.todayKey();
    this.setData({
      showForm: true,
      editingId: "",
      formErrors: {}
    });
    this.setForm({
      ...emptyForm(this.data.activeTime),
      categoryName,
      date
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

  noop() {},

  editRecord(event) {
    this.closeRecordSwipe();
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
      timeOfDay: record.timeOfDay,
      date: record.date
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

  onDatePick(event) {
    this.setForm({
      ...this.data.form,
      date: event.detail.value
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
        date: this.data.form.date || store.todayKey()
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
          this.setData({ swipedRecordId: "" });
          this.refresh();
          wx.showToast({ title: "已删除", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        }
      }
    });
  }
});

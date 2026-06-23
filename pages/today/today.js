const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const TIME_OPTIONS = [
  { label: "早间", fullLabel: "早间护肤", value: "morning" },
  { label: "晚间", fullLabel: "晚间护肤", value: "evening" }
];
const MAX_AMOUNT_LENGTH = 30;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIME_OF_DAY = defaultTimeOfDay();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

function parseLocalDate(key) {
  const parts = String(key).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isValidDateKey(dateKey) {
  if (!DATE_KEY_PATTERN.test(String(dateKey || ""))) {
    return false;
  }
  return store.todayKey(parseLocalDate(dateKey)) === dateKey;
}

function isAfterDate(dateKey, targetDateKey) {
  return parseLocalDate(dateKey).getTime() > parseLocalDate(targetDateKey).getTime();
}

function shiftDateKey(dateKey, days) {
  return store.todayKey(addDays(parseLocalDate(dateKey), days));
}

function normalizeViewDate(dateKey) {
  const today = store.todayKey();
  if (!isValidDateKey(dateKey)) {
    return today;
  }
  return isAfterDate(dateKey, today) ? today : dateKey;
}

function viewDateText(dateKey) {
  const today = store.todayKey();
  const yesterday = store.todayKey(addDays(new Date(), -1));
  if (dateKey === today) {
    return `${dateKey} · 今天`;
  }
  if (dateKey === yesterday) {
    return `${dateKey} · 昨天`;
  }
  return dateKey;
}

function copyActionText(dateKey) {
  return dateKey === store.todayKey() ? "复制昨日" : "复制前一天";
}

function copySourceText(dateKey) {
  return dateKey === store.todayKey() ? "昨日" : "前一天";
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

function filterProductOptions(options, keyword) {
  const query = trim(keyword).toLowerCase();
  if (!query) {
    return options;
  }
  return options.filter((name) => String(name || "").toLowerCase().includes(query));
}

function previousDateKey(dateKey) {
  const parts = String(dateKey).split("-").map(Number);
  return store.todayKey(new Date(new Date(parts[0], parts[1] - 1, parts[2]).getTime() - ONE_DAY_MS));
}

function duplicateRecordKey(record) {
  return [
    record.timeOfDay,
    record.productNameSnapshot,
    record.categoryNameSnapshot
  ].join("|");
}

function moveItem(items, fromIndex, toIndex) {
  const nextItems = items.slice();
  const item = nextItems.splice(fromIndex, 1)[0];
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

Page({
  data: {
    viewDate: store.todayKey(),
    viewDateText: viewDateText(store.todayKey()),
    copyActionText: copyActionText(store.todayKey()),
    copySourceText: copySourceText(store.todayKey()),
    canGoNextDate: false,
    categories: [],
    productOptions: [],
    filteredProductOptions: [],
    records: [],
    activeRecords: [],
    timeOptions: TIME_OPTIONS,
    activeTime: DEFAULT_TIME_OF_DAY,
    categoryIndex: 0,
    submitting: false,
    swipedRecordId: "",
    showForm: false,
    showProductSelector: false,
    productSearchKeyword: "",
    draggingRecordId: "",
    editingId: "",
    formErrors: {},
    canSubmit: false,
    form: emptyForm(DEFAULT_TIME_OF_DAY)
  },

  onLoad(options = {}) {
    if (options.date) {
      const viewDate = normalizeViewDate(options.date);
      this.setData({
        viewDate,
        form: {
          ...this.data.form,
          date: viewDate
        }
      });
      this.pendingRecordDate = viewDate;
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
      const viewDate = normalizeViewDate(this.data.viewDate || store.todayKey());
      const categories = store.listCategories().map((item) => item.name);
      const categoryName = this.data.form.categoryName || categories[0] || "未分类";
      const form = {
        ...this.data.form,
        categoryName
      };
      const productOptions = store.productOptions();
      const records = store.listTodayRecords(viewDate);
      this.setData({
        viewDate,
        viewDateText: viewDateText(viewDate),
        copyActionText: copyActionText(viewDate),
        copySourceText: copySourceText(viewDate),
        canGoNextDate: viewDate !== store.todayKey(),
        categories,
        productOptions,
        filteredProductOptions: filterProductOptions(productOptions, this.data.productSearchKeyword),
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

  changeViewDate(dayOffset) {
    const baseDate = this.data.viewDate || store.todayKey();
    const nextDate = normalizeViewDate(shiftDateKey(baseDate, dayOffset));
    if (nextDate === this.data.viewDate) {
      return;
    }
    this.setData({
      viewDate: nextDate,
      swipedRecordId: "",
      form: {
        ...this.data.form,
        date: nextDate
      }
    });
    this.refresh();
  },

  goPreviousDate() {
    this.changeViewDate(-1);
  },

  goNextDate() {
    if (!this.data.canGoNextDate) {
      return;
    }
    this.changeViewDate(1);
  },

  onPageTouchStart(event) {
    if (this.data.showForm || this.recordGestureActive) {
      return;
    }
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.pageTouchStartX = touch.clientX;
    this.pageTouchStartY = touch.clientY;
  },

  onPageTouchEnd(event) {
    if (this.skipNextPageTouchEnd) {
      this.skipNextPageTouchEnd = false;
      this.pageTouchStartX = undefined;
      this.pageTouchStartY = undefined;
      return;
    }
    if (this.data.showForm || this.pageTouchStartX === undefined) {
      return;
    }
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - this.pageTouchStartX;
    const deltaY = touch.clientY - this.pageTouchStartY;

    this.pageTouchStartX = undefined;
    this.pageTouchStartY = undefined;

    if (Math.abs(deltaY) > Math.abs(deltaX) || Math.abs(deltaX) < 60) {
      return;
    }
    this.changeViewDate(deltaX > 0 ? -1 : 1);
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
    this.recordGestureActive = true;
    this.skipNextPageTouchEnd = true;
    this.pageTouchStartX = undefined;
    this.pageTouchStartY = undefined;
  },

  onRecordTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.recordTouchStartX === undefined) {
      this.recordGestureActive = false;
      return;
    }
    const deltaX = touch.clientX - this.recordTouchStartX;
    const deltaY = touch.clientY - this.recordTouchStartY;
    const id = event.currentTarget.dataset.id;

    this.recordTouchStartX = undefined;
    this.recordTouchStartY = undefined;
    this.recordGestureActive = false;

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

  captureRecordRects() {
    if (typeof wx === "undefined" || !wx.createSelectorQuery) {
      return;
    }
    wx.createSelectorQuery()
      .selectAll(".record-swipe-item")
      .boundingClientRect((rects) => {
        this.recordDragRects = rects || [];
      })
      .exec();
  },

  findDragTargetIndex(clientY) {
    const rects = this.recordDragRects || [];
    if (!rects.length) {
      return -1;
    }
    return rects.reduce((targetIndex, rect, index) => {
      const targetRect = rects[targetIndex];
      const currentDistance = Math.abs(clientY - (rect.top + rect.height / 2));
      const targetDistance = Math.abs(clientY - (targetRect.top + targetRect.height / 2));
      return currentDistance < targetDistance ? index : targetIndex;
    }, 0);
  },

  onRecordDragStart(event) {
    const touch = event.touches && event.touches[0];
    const id = event.currentTarget.dataset.id;
    if (!touch || !id || this.data.activeRecords.length < 2) {
      return;
    }
    this.recordDragId = id;
    this.setData({
      draggingRecordId: id,
      swipedRecordId: "",
      activeRecords: this.data.activeRecords.map((record) => ({ ...record, swiped: false }))
    });
    this.captureRecordRects();
  },

  onRecordDragMove(event) {
    const touch = event.touches && event.touches[0];
    if (!touch || !this.recordDragId) {
      return;
    }
    const fromIndex = this.data.activeRecords.findIndex((record) => record.id === this.recordDragId);
    const toIndex = this.findDragTargetIndex(touch.clientY);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return;
    }
    this.setData({
      activeRecords: moveItem(this.data.activeRecords, fromIndex, toIndex)
    });
    this.captureRecordRects();
  },

  onRecordDragEnd() {
    if (!this.recordDragId) {
      return;
    }
    const orderedIds = this.data.activeRecords.map((record) => record.id);
    this.recordDragId = "";
    try {
      store.reorderUsageRecords(this.data.viewDate, this.data.activeTime, orderedIds);
      this.setData({ draggingRecordId: "" });
      this.refresh();
    } catch (error) {
      this.setData({ draggingRecordId: "" });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  switchFormTime(event) {
    const timeOfDay = event.currentTarget.dataset.value;
    this.hasManualTimeSelection = true;
    this.setForm({ ...this.data.form, timeOfDay });
  },

  openCreateForm(options = {}) {
    const categoryName = this.data.categories[0] || "未分类";
    const date = normalizeViewDate(
      options.date || (options.currentTarget && options.currentTarget.dataset.date) || this.data.viewDate || store.todayKey()
    );
    this.setData({
      viewDate: date,
      viewDateText: viewDateText(date),
      copyActionText: copyActionText(date),
      copySourceText: copySourceText(date),
      canGoNextDate: date !== store.todayKey(),
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
      showProductSelector: false,
      productSearchKeyword: "",
      editingId: "",
      formErrors: {},
      submitting: false
    });
    this.refresh();
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

  copyPreviousDateRecords() {
    const targetDate = this.data.viewDate || store.todayKey();
    const sourceDate = previousDateKey(targetDate);
    const activeTime = this.data.activeTime;
    const sourceText = copySourceText(targetDate);
    const sourceRecords = store.listTodayRecords(sourceDate)
      .filter((record) => record.timeOfDay === activeTime);
    if (!sourceRecords.length) {
      wx.showToast({
        title: `${sourceText}${activeTime === "morning" ? "早间" : "晚间"}无记录`,
        icon: "none"
      });
      return;
    }

    const existingKeys = new Set(
      store.listTodayRecords(targetDate)
        .filter((record) => record.timeOfDay === activeTime)
        .map(duplicateRecordKey)
    );
    let copiedCount = 0;
    try {
      sourceRecords.forEach((record) => {
        if (existingKeys.has(duplicateRecordKey(record))) {
          return;
        }
        store.addUsageRecord({
          name: record.productNameSnapshot,
          categoryName: record.categoryNameSnapshot,
          amount: record.amount,
          timeOfDay: record.timeOfDay,
          date: targetDate
        });
        copiedCount += 1;
      });
      this.refresh();
      wx.showToast({
        title: copiedCount ? `已复制 ${copiedCount} 项` : "这天已存在",
        icon: copiedCount ? "success" : "none"
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
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

  clearFormField(event) {
    const field = event.currentTarget.dataset.field;
    this.setForm({
      ...this.data.form,
      [field]: ""
    }, {
      ...this.data.formErrors,
      [field]: ""
    });
  },

  openProductSelector() {
    this.setData({
      showProductSelector: true,
      productSearchKeyword: "",
      filteredProductOptions: this.data.productOptions
    });
  },

  closeProductSelector() {
    this.setData({
      showProductSelector: false,
      productSearchKeyword: "",
      filteredProductOptions: this.data.productOptions
    });
  },

  onProductSearchInput(event) {
    const productSearchKeyword = event.detail.value;
    this.setData({
      productSearchKeyword,
      filteredProductOptions: filterProductOptions(this.data.productOptions, productSearchKeyword)
    });
  },

  selectProduct(event) {
    const productName = event.currentTarget.dataset.name;
    this.setForm({
      ...this.data.form,
      productName
    }, {
      ...this.data.formErrors,
      productName: ""
    });
    this.closeProductSelector();
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
      content: "删除后，这一天和回看统计会同步更新。",
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

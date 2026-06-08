const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const STATUS_OPTIONS = [
  { label: "囤货", value: "stocked", note: "未开瓶，可开瓶或删除", emptyTitle: "还没有囤货", emptyText: "新增库存后，可以在这里记录开瓶。" },
  { label: "使用中", value: "active", note: "已开瓶，可标记用完", emptyTitle: "还没有使用中的产品", emptyText: "从囤货列表中开瓶后，会显示在这里。" },
  { label: "已用完", value: "finished", note: "历史归档，仅查看", emptyTitle: "还没有用完记录", emptyText: "标记用完后会自动归档，方便回顾空瓶节奏。" }
];
const MAX_TEXT_LENGTH = 30;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trim(value) {
  return String(value || "").trim();
}

function emptyForm(categoryName) {
  return {
    productName: "",
    categoryName: categoryName || "洁面",
    capacity: "",
    quantity: 1,
    expiryDate: ""
  };
}

function validateStockForm(form) {
  const errors = {};
  const quantity = Number(form.quantity);
  if (!trim(form.productName)) {
    errors.productName = "请填写产品名称";
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    errors.quantity = "数量需为 1 或以上整数";
  }
  if (trim(form.capacity).length > MAX_TEXT_LENGTH) {
    errors.capacity = `规格/容量请控制在 ${MAX_TEXT_LENGTH} 字以内`;
  }
  if (form.expiryDate && !DATE_KEY_PATTERN.test(form.expiryDate)) {
    errors.expiryDate = "日期格式需为 YYYY-MM-DD";
  }
  return errors;
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

function statusMeta(status) {
  return STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0];
}

function canSubmitStock(form, submitting) {
  return !submitting && !hasErrors(validateStockForm(form));
}

function filterStocksByCategory(stocks, categoryName) {
  if (!categoryName) {
    return stocks;
  }
  return stocks.filter((stock) => stock.categoryNameSnapshot === categoryName);
}

function compareStockName(left, right) {
  return String(left.productNameSnapshot || "").localeCompare(String(right.productNameSnapshot || ""));
}

function sortStocks(stocks, sortMode) {
  return stocks.slice().sort((left, right) => {
    if (sortMode === "expiry") {
      const leftDate = left.expiryDateSnapshot || "9999-12-31";
      const rightDate = right.expiryDateSnapshot || "9999-12-31";
      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
    }
    return compareStockName(left, right);
  });
}

Page({
  data: {
    categories: [],
    categoryIndex: 0,
    filterTabs: [{ label: "全部", value: "", active: true }],
    filterCategoryName: "",
    sortMode: "name",
    status: "stocked",
    statusOptions: STATUS_OPTIONS,
    statusTabs: STATUS_OPTIONS.map((item) => ({ ...item, count: 0 })),
    statusNote: statusMeta("stocked").note,
    emptyTitle: statusMeta("stocked").emptyTitle,
    emptyText: statusMeta("stocked").emptyText,
    stockCounts: { stocked: 0, active: 0, finished: 0 },
    stocks: [],
    submitting: false,
    updatingStockId: "",
    swipedStockId: "",
    showForm: false,
    editingStockId: "",
    formErrors: {},
    canSubmit: false,
    form: emptyForm("洁面")
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
      canSubmit: canSubmitStock(nextForm, this.data.submitting)
    });
  },

  refresh(nextStatus = this.data.status) {
    try {
      const categories = store.listCategories().map((item) => item.name);
      const categoryName = this.data.form.categoryName || categories[0] || "未分类";
      const currentFilterName = this.data.filterCategoryName;
      const filterCategoryName = categories.includes(currentFilterName) ? currentFilterName : "";
      const filterTabs = [
        { label: "全部", value: "", active: !filterCategoryName },
        ...categories.map((name) => ({ label: name, value: name, active: filterCategoryName === name }))
      ];
      const allStocks = filterStocksByCategory(store.listStocks(), filterCategoryName);
      const meta = statusMeta(nextStatus);
      const stockCounts = {
        stocked: allStocks.filter((stock) => stock.status === "stocked").length,
        active: allStocks.filter((stock) => stock.status === "active").length,
        finished: allStocks.filter((stock) => stock.status === "finished").length
      };
      this.setData({
        categories,
        filterTabs,
        filterCategoryName,
        categoryIndex: Math.max(0, categories.indexOf(categoryName)),
        status: nextStatus,
        statusNote: meta.note,
        emptyTitle: meta.emptyTitle,
        emptyText: meta.emptyText,
        stocks: sortStocks(allStocks.filter((stock) => stock.status === nextStatus), this.data.sortMode)
          .map((stock) => ({
            ...stock,
            swiped: stock.id === this.data.swipedStockId,
            swipeClass: stock.id === this.data.swipedStockId
              ? (stock.status === "stocked" ? "stock-card-front-open-delete" : "stock-card-front-open-edit")
              : ""
          })),
        stockCounts,
        statusTabs: STATUS_OPTIONS.map((item) => ({ ...item, count: stockCounts[item.value] || 0 })),
        form: { ...this.data.form, categoryName },
        canSubmit: canSubmitStock({ ...this.data.form, categoryName }, this.data.submitting)
      });
    } catch (error) {
      this.setData({ stocks: [], stockCounts: { stocked: 0, active: 0, finished: 0 } });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  switchStatus(event) {
    this.setData({ swipedStockId: "" });
    this.refresh(event.currentTarget.dataset.status);
  },

  switchFilterCategory(event) {
    const filterCategoryName = event.currentTarget.dataset.category || "";
    this.setData({
      filterCategoryName,
      swipedStockId: ""
    });
    this.refresh(this.data.status);
  },

  resetFilterCategory() {
    this.setData({
      filterCategoryName: "",
      swipedStockId: ""
    });
    this.refresh(this.data.status);
  },

  noop() {},

  toggleSortMode() {
    const sortMode = this.data.sortMode === "name" ? "expiry" : "name";
    this.setData({
      sortMode,
      swipedStockId: ""
    });
    this.refresh(this.data.status);
    wx.showToast({
      title: sortMode === "name" ? "按名称排序" : "按到期排序",
      icon: "none"
    });
  },

  onStockTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  },

  onStockTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.touchStartX === undefined) {
      return;
    }
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;

    this.touchStartX = undefined;
    this.touchStartY = undefined;

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }
    if (deltaX < -45) {
      this.setData({ swipedStockId: id });
      this.refresh(this.data.status);
      return;
    }
    if (deltaX > 30 || this.data.swipedStockId) {
      this.setData({ swipedStockId: "" });
      this.refresh(this.data.status);
    }
  },

  closeSwipe() {
    if (!this.data.swipedStockId) {
      return;
    }
    this.setData({ swipedStockId: "" });
    this.refresh(this.data.status);
  },

  openCreateForm() {
    this.setData({
      showForm: true,
      editingStockId: "",
      formErrors: {}
    });
    this.setForm(emptyForm(this.data.categories[0] || "未分类"));
  },

  editStock(event) {
    this.closeSwipe();
    const id = event.currentTarget.dataset.id;
    const stock = store.listStocks().find((item) => item.id === id);
    if (!stock) {
      return;
    }
    this.setData({
      showForm: true,
      editingStockId: id,
      formErrors: {}
    });
    this.setForm({
      productName: stock.productNameSnapshot,
      categoryName: stock.categoryNameSnapshot,
      capacity: stock.capacitySnapshot,
      quantity: stock.quantity,
      expiryDate: stock.expiryDateSnapshot
    });
  },

  swipeEditStock(event) {
    this.editStock(event);
  },

  swipeDeleteStock(event) {
    this.deleteStock(event);
  },

  closeForm() {
    this.setData({
      showForm: false,
      editingStockId: "",
      formErrors: {},
      submitting: false
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

  onExpiryPick(event) {
    this.setForm({
      ...this.data.form,
      expiryDate: event.detail.value
    }, {
      ...this.data.formErrors,
      expiryDate: ""
    });
  },

  submitStock() {
    if (this.data.submitting) {
      return;
    }
    const formErrors = validateStockForm(this.data.form);
    if (hasErrors(formErrors)) {
      this.setData({ formErrors, canSubmit: false });
      wx.showToast({ title: formErrors.productName || formErrors.quantity || formErrors.capacity || formErrors.expiryDate, icon: "none" });
      return;
    }

    this.setData({ submitting: true, canSubmit: false });
    try {
      const payload = {
        name: this.data.form.productName,
        categoryName: this.data.form.categoryName,
        capacity: this.data.form.capacity,
        quantity: this.data.form.quantity,
        expiryDate: this.data.form.expiryDate
      };
      const editingStockId = this.data.editingStockId;
      if (editingStockId) {
        store.updateStock(editingStockId, payload);
      } else {
        store.addStock(payload);
      }
      this.closeForm();
      this.refresh(editingStockId ? this.data.status : "stocked");
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({
        submitting: false,
        canSubmit: canSubmitStock(this.data.form, false)
      });
    }
  },

  confirmStockAction({ id, title, content, confirmText, nextStatus, successTitle }) {
    wx.showModal({
      title,
      content,
      confirmText,
      confirmColor: nextStatus ? "#111827" : "#FF3B30",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        this.setData({ updatingStockId: id });
        try {
          if (nextStatus) {
            store.updateStockStatus(id, nextStatus);
          } else {
            store.deleteStock(id);
          }
          this.setData({ swipedStockId: "" });
          this.refresh(this.data.status);
          wx.showToast({ title: successTitle, icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message, icon: "none" });
        } finally {
          this.setData({ updatingStockId: "" });
        }
      }
    });
  },

  openStock(event) {
    if (this.data.updatingStockId) {
      return;
    }
    this.confirmStockAction({
      id: event.currentTarget.dataset.id,
      title: "确认开瓶？",
      content: "开瓶后会进入使用中，并记录今天为开瓶日期。",
      confirmText: "确认开瓶",
      nextStatus: "active",
      successTitle: "已开瓶"
    });
  },

  finishStock(event) {
    if (this.data.updatingStockId) {
      return;
    }
    this.confirmStockAction({
      id: event.currentTarget.dataset.id,
      title: "标记为已用完？",
      content: "完成后会进入已用完列表，方便之后回顾。",
      confirmText: "标记用完",
      nextStatus: "finished",
      successTitle: "已标记用完"
    });
  },

  deleteStock(event) {
    if (this.data.updatingStockId) {
      return;
    }
    this.confirmStockAction({
      id: event.currentTarget.dataset.id,
      title: "删除这件囤货？",
      content: "仅未开瓶库存可删除，删除后不可恢复。",
      confirmText: "删除",
      nextStatus: "",
      successTitle: "已删除"
    });
  }
});

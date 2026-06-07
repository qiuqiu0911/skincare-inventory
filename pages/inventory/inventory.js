const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const STATUS_OPTIONS = [
  { label: "使用中", value: "active", note: "已开瓶，可标记用完", emptyTitle: "还没有使用中的产品", emptyText: "从囤货列表中开瓶后，会显示在这里。" },
  { label: "囤货", value: "stocked", note: "未开瓶，可开瓶或删除", emptyTitle: "还没有囤货", emptyText: "新增库存后，可以在这里记录开瓶。" },
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

Page({
  data: {
    categories: [],
    categoryIndex: 0,
    status: "active",
    statusOptions: STATUS_OPTIONS,
    statusTabs: STATUS_OPTIONS.map((item) => ({ ...item, count: 0 })),
    statusNote: STATUS_OPTIONS[0].note,
    emptyTitle: STATUS_OPTIONS[0].emptyTitle,
    emptyText: STATUS_OPTIONS[0].emptyText,
    stockCounts: { stocked: 0, active: 0, finished: 0 },
    stocks: [],
    submitting: false,
    updatingStockId: "",
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
      const meta = statusMeta(nextStatus);
      const stockCounts = {
        stocked: store.listStocks("stocked").length,
        active: store.listStocks("active").length,
        finished: store.listStocks("finished").length
      };
      this.setData({
        categories,
        categoryIndex: Math.max(0, categories.indexOf(categoryName)),
        status: nextStatus,
        statusNote: meta.note,
        emptyTitle: meta.emptyTitle,
        emptyText: meta.emptyText,
        stocks: store.listStocks(nextStatus),
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
    this.refresh(event.currentTarget.dataset.status);
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

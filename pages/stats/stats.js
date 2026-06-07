const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const REVIEW_TABS = [
  { label: "近 3 天", value: "3days", icon: "↺" },
  { label: "本周", value: "week", icon: "□" }
];
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseLocalDate(key) {
  const parts = String(key).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function dayLabel(dateKey) {
  const today = store.todayKey();
  const yesterday = store.todayKey(addDays(new Date(), -1));
  if (dateKey === today) {
    return "今天";
  }
  if (dateKey === yesterday) {
    return "昨天";
  }
  return "前天";
}

function shortDate(dateKey) {
  return dateKey.slice(5).replace("-", "/");
}

function buildThreeDays(items) {
  return items.slice().reverse().map((item) => {
    const records = store.listTodayRecords(item.date);
    return {
      ...item,
      label: dayLabel(item.date),
      shortDate: shortDate(item.date),
      morning: records.filter((record) => record.timeOfDay === "morning"),
      evening: records.filter((record) => record.timeOfDay === "evening")
    };
  });
}

function buildWeek() {
  const matrix = store.weeklyUsageMatrix();
  const days = matrix.days.map((dateKey) => {
    const date = parseLocalDate(dateKey);
    return {
      date: dateKey,
      label: WEEKDAY_LABELS[date.getDay()],
      isToday: dateKey === store.todayKey()
    };
  });
  const rows = matrix.rows.map((row) => ({
    ...row,
    cells: days.map((day) => ({
      date: day.date,
      used: !!row.days[day.date]
    }))
  }));
  return {
    days,
    rows,
    start: shortDate(matrix.days[0]),
    end: shortDate(matrix.days[matrix.days.length - 1]),
    recordCount: rows.reduce((total, row) => total + row.total, 0),
    productCount: rows.length
  };
}

Page({
  data: {
    activeTab: "3days",
    tabs: REVIEW_TABS,
    rangeText: "",
    threeDays: [],
    week: {
      days: [],
      rows: [],
      start: "",
      end: "",
      recordCount: 0,
      productCount: 0
    }
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
      const week = buildWeek();
      this.setData({
        threeDays: buildThreeDays(store.threeDayStats()),
        week,
        rangeText: `${week.start} - ${week.end}`
      });
    } catch (error) {
      this.setData({ threeDays: [], week: { days: [], rows: [], start: "", end: "", recordCount: 0, productCount: 0 } });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  switchTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.value });
  },

  goToday() {
    wx.switchTab({ url: "/pages/today/today" });
  }
});

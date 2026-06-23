const store = require("../../utils/store");
const cloudConfig = require("../../utils/cloudConfig");

const REVIEW_TABS = [
  {
    label: "近 3 天",
    value: "3days",
    iconPath: "/assets/icons/review-recent.png",
    activeIconPath: "/assets/icons/review-recent-active.png"
  },
  {
    label: "本周",
    value: "week",
    iconPath: "/assets/icons/review-week.png",
    activeIconPath: "/assets/icons/review-week-active.png"
  }
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
  return items.map((item) => {
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

function buildWeek(baseDateKey = store.todayKey()) {
  const matrix = store.weeklyUsageMatrix(baseDateKey);
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
      morning: !!(row.days[day.date] && row.days[day.date].morning),
      evening: !!(row.days[day.date] && row.days[day.date].evening)
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
    weekBaseDate: store.todayKey(),
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
      const week = buildWeek(this.data.weekBaseDate);
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

  updateWeekByOffset(offset) {
    const weekBaseDate = store.todayKey(addDays(parseLocalDate(this.data.weekBaseDate), offset * 7));
    const week = buildWeek(weekBaseDate);
    this.setData({
      weekBaseDate,
      week,
      rangeText: `${week.start} - ${week.end}`
    });
  },

  onWeekTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.weekTouchStartX = touch.clientX;
    this.weekTouchStartY = touch.clientY;
  },

  onWeekTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch || this.weekTouchStartX === undefined) {
      return;
    }
    const deltaX = touch.clientX - this.weekTouchStartX;
    const deltaY = touch.clientY - this.weekTouchStartY;

    this.weekTouchStartX = undefined;
    this.weekTouchStartY = undefined;

    if (Math.abs(deltaY) > Math.abs(deltaX) || Math.abs(deltaX) < 55) {
      return;
    }
    this.updateWeekByOffset(deltaX < 0 ? 1 : -1);
  },

  switchTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.value });
  },

  addRecordForDay(event) {
    const date = event.currentTarget.dataset.date;
    wx.switchTab({
      url: "/pages/today/today",
      success: () => {
        const pages = getCurrentPages();
        const todayPage = pages[pages.length - 1];
        if (todayPage) {
          if (typeof todayPage.openCreateForm === "function") {
            todayPage.openCreateForm({ date });
          } else {
            todayPage.pendingRecordDate = date;
          }
        }
      }
    });
  },

  goToday() {
    wx.switchTab({ url: "/pages/today/today" });
  }
});

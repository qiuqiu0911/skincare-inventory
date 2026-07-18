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
  },
  {
    label: "月历",
    value: "month",
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

function monthDateText(dateKey) {
  const date = parseLocalDate(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function monthLabel(year, month) {
  return `${year}年${month}月`;
}

function weekdayText(dateKey) {
  return `周${WEEKDAY_LABELS[parseLocalDate(dateKey).getDay()]}`;
}

function selectedDayTitle(dateKey) {
  const today = store.todayKey();
  const yesterday = store.todayKey(addDays(new Date(), -1));
  if (dateKey === today) {
    return "今天";
  }
  if (dateKey === yesterday) {
    return "昨天";
  }
  return monthDateText(dateKey);
}

function selectedDayMeta(dateKey, recordCount, productCount) {
  const usageText = recordCount ? `${recordCount} 项 · ${productCount} 个产品` : "未记录";
  return `${dateKey} · ${weekdayText(dateKey)} · ${usageText}`;
}

function shiftMonthDate(dateKey, monthOffset) {
  const sourceDate = parseLocalDate(dateKey);
  const targetMonthStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth() + monthOffset, 1);
  const targetMonthDays = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
  targetMonthStart.setDate(Math.min(sourceDate.getDate(), targetMonthDays));
  return store.todayKey(targetMonthStart);
}

function classNames(items) {
  return items.filter(Boolean).join(" ");
}

function buildCalendarCellClass(cell) {
  return classNames([
    "calendar-cell",
    cell.inMonth ? "" : "calendar-cell-empty",
    cell.isSelected ? "calendar-cell-selected" : "",
    cell.isToday ? "calendar-cell-today" : "",
    cell.hasRecords ? "calendar-cell-used" : ""
  ]);
}

function buildCalendarDotClass(active, timeOfDay) {
  return classNames([
    "calendar-dot",
    timeOfDay === "morning" ? "calendar-dot-morning" : "calendar-dot-evening",
    active ? "calendar-dot-on" : ""
  ]);
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

function buildSelectedDay(dateKey) {
  const records = store.listTodayRecords(dateKey);
  const productCount = new Set(records.map((record) => record.productNameSnapshot).filter(Boolean)).size;
  return {
    date: dateKey,
    title: selectedDayTitle(dateKey),
    metaText: selectedDayMeta(dateKey, records.length, productCount),
    shortDate: shortDate(dateKey),
    recordCount: records.length,
    productCount,
    morning: records.filter((record) => record.timeOfDay !== "evening"),
    evening: records.filter((record) => record.timeOfDay === "evening")
  };
}

function buildCalendar(monthDateKey, selectedDateKey) {
  const calendar = store.monthlyUsageCalendar(monthDateKey, selectedDateKey);
  const cells = calendar.cells.map((cell) => ({
    ...cell,
    ariaLabel: cell.date || "空白日期",
    className: buildCalendarCellClass(cell),
    morningClass: buildCalendarDotClass(cell.morning, "morning"),
    eveningClass: buildCalendarDotClass(cell.evening, "evening")
  }));
  const summaryText = calendar.usedDayCount
    ? `${calendar.usedDayCount} 天有记录 · ${calendar.recordCount} 项`
    : "本月暂无记录";
  return {
    ...calendar,
    cells,
    weeks: Array.from(
      { length: Math.ceil(cells.length / 7) },
      (_, index) => cells.slice(index * 7, index * 7 + 7)
    ),
    monthLabel: monthLabel(calendar.year, calendar.month),
    summaryText,
    weekdays: Array.from(
      { length: 7 },
      (_, index) => WEEKDAY_LABELS[(calendar.firstWeekday + index) % 7]
    )
  };
}

function pageMeta(activeTab, threeDays, week, calendar, selectedDay) {
  if (activeTab === "week") {
    return {
      pageTitle: "本周回看",
      rangeText: `${week.start} - ${week.end}`
    };
  }
  if (activeTab === "month") {
    return {
      pageTitle: "月度回看",
      rangeText: `${calendar.monthLabel} · ${selectedDay.shortDate}`
    };
  }
  return {
    pageTitle: "近 3 天",
    rangeText: threeDays.length ? `${threeDays[0].shortDate} - ${threeDays[threeDays.length - 1].shortDate}` : ""
  };
}

Page({
  data: {
    activeTab: "3days",
    tabs: REVIEW_TABS,
    pageTitle: "近 3 天",
    rangeText: "",
    weekBaseDate: store.todayKey(),
    calendarMonthDate: store.todayKey(),
    selectedCalendarDate: store.todayKey(),
    threeDays: [],
    week: {
      days: [],
      rows: [],
      start: "",
      end: "",
      recordCount: 0,
      productCount: 0
    },
    calendar: {
      year: 0,
      month: 0,
      monthKey: "",
      monthLabel: "",
      summaryText: "",
      weekdays: [],
      cells: [],
      weeks: [],
      recordCount: 0,
      usedDayCount: 0,
      productCount: 0
    },
    selectedDay: {
      date: store.todayKey(),
      title: "今天",
      metaText: "",
      shortDate: shortDate(store.todayKey()),
      recordCount: 0,
      productCount: 0,
      morning: [],
      evening: []
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
      const threeDays = buildThreeDays(store.threeDayStats());
      const week = buildWeek(this.data.weekBaseDate);
      const selectedDay = buildSelectedDay(this.data.selectedCalendarDate);
      const calendar = buildCalendar(this.data.calendarMonthDate, this.data.selectedCalendarDate);
      this.setData({
        threeDays,
        week,
        calendar,
        selectedDay,
        ...pageMeta(this.data.activeTab, threeDays, week, calendar, selectedDay)
      });
    } catch (error) {
      this.setData({
        threeDays: [],
        week: { days: [], rows: [], start: "", end: "", recordCount: 0, productCount: 0 },
        calendar: {
          year: 0,
          month: 0,
          monthKey: "",
          monthLabel: "",
          summaryText: "",
          weekdays: [],
          cells: [],
          weeks: [],
          recordCount: 0,
          usedDayCount: 0,
          productCount: 0
        },
        selectedDay: {
          date: this.data.selectedCalendarDate,
          title: "",
          metaText: "",
          shortDate: "",
          recordCount: 0,
          productCount: 0,
          morning: [],
          evening: []
        }
      });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  updateWeekByOffset(offset) {
    const weekBaseDate = store.todayKey(addDays(parseLocalDate(this.data.weekBaseDate), offset * 7));
    const week = buildWeek(weekBaseDate);
    this.setData({
      weekBaseDate,
      week,
      ...pageMeta(this.data.activeTab, this.data.threeDays, week, this.data.calendar, this.data.selectedDay)
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
    const activeTab = event.currentTarget.dataset.value;
    this.setData({
      activeTab,
      ...pageMeta(activeTab, this.data.threeDays, this.data.week, this.data.calendar, this.data.selectedDay)
    });
  },

  changeCalendarDate(date) {
    this.setData({
      selectedCalendarDate: date,
      calendarMonthDate: date
    });
    this.refresh();
  },

  selectCalendarDay(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    this.changeCalendarDate(date);
  },

  onCalendarDatePick(event) {
    this.changeCalendarDate(event.detail.value);
  },

  changeCalendarMonth(offset) {
    const baseDate = this.data.selectedCalendarDate || this.data.calendarMonthDate || store.todayKey();
    const date = shiftMonthDate(baseDate, offset);
    this.changeCalendarDate(date);
  },

  goPreviousMonth() {
    this.changeCalendarMonth(-1);
  },

  goNextMonth() {
    this.changeCalendarMonth(1);
  },

  goCurrentMonth() {
    this.changeCalendarDate(store.todayKey());
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

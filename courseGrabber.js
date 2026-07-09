// 仓库地址（持续维护、更新中）: https://github.com/ceilf6/Auto_courseGrabber
// 适用：东北电力大学强智教务 (jwxt.neepu.edu.cn /jsxsd/)

// 使用方法:
// 1. 登录教务系统并进入公选课页面 (comeInGgxxkxk)
// 2. 配置 TARGET_COURSES 或在 UI 面板添加课程
// 3. F12 控制台粘贴此脚本并执行
// 4. grab.start() 开始抢课

(function () {
  const __CG_GLOBAL__ = typeof window !== "undefined" ? window : globalThis;
  const __CG_LOADED_KEY__ = "__AUTO_COURSE_GRABBER_LOADED__";
  const __CG_INSTANCE_KEY__ = "__AUTO_COURSE_GRABBER_INSTANCE_ID__";
  const __CG_CLEANUP_KEY__ = "__AUTO_COURSE_GRABBER_CLEANUP__";

  function cleanupPreviousInstance(reason = "unknown") {
    const previousCleanup = __CG_GLOBAL__[__CG_CLEANUP_KEY__];
    if (typeof previousCleanup === "function") {
      try {
        previousCleanup(reason);
      } catch (e) {}
    }
    if (__CG_GLOBAL__.grab && typeof __CG_GLOBAL__.grab.stop === "function") {
      try {
        __CG_GLOBAL__.grab.stop();
      } catch (e) {}
    }
  }

  if (__CG_GLOBAL__[__CG_LOADED_KEY__]) {
    cleanupPreviousInstance("reload");
    console.warn("[抢课脚本] 检测到重复加载，已清理旧实例。");
  }

  __CG_GLOBAL__[__CG_LOADED_KEY__] = true;
  __CG_GLOBAL__[__CG_INSTANCE_KEY__] =
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  ("use strict");

  const nativeArrayFilter = Array.prototype.filter;
  const nativeArrayMap = Array.prototype.map;

  function safeFilter(array, callback) {
    if (!array || !Array.isArray(array)) return [];
    try {
      return nativeArrayFilter.call(array, callback);
    } catch (e) {
      const result = [];
      for (let i = 0; i < array.length; i++) {
        try {
          if (callback(array[i], i, array)) result.push(array[i]);
        } catch (err) {}
      }
      return result;
    }
  }

  function safeMap(array, callback) {
    if (!array || !Array.isArray(array)) return [];
    try {
      return nativeArrayMap.call(array, callback);
    } catch (e) {
      const result = [];
      for (let i = 0; i < array.length; i++) {
        try {
          result.push(callback(array[i], i, array));
        } catch (err) {
          result.push(undefined);
        }
      }
      return result;
    }
  }

  // ========== 配置 ==========
  const TARGET_COURSES = [];

  const CHECK_INTERVAL = 150;
  const MAX_ATTEMPTS = 3000;
  const MAX_FAILED_ATTEMPTS = 10;
  const CONCURRENT_ENABLED = true;

  const GLOBAL_TIME_FILTER = [];
  const GLOBAL_TEACHER_FILTER = [];

  // ========== 状态 ==========
  let attemptCount = 0;
  let isRunning = false;
  let intervalId = null;
  let courseStates = new Map();
  let selectedCourses = new Set();
  let activeCourses = new Set();
  const grabbingInProgress = new Set();

  let scheduledTime = null;
  let schedulerIntervalId = null;
  let isScheduled = false;
  let scheduleModeEnabled = false;

  // ========== 东北电力 fetch 接口 ==========
  const API = {
    queryPath: "/jsxsd/xsxkkc/xsxkGgxxkxk",
    queryString:
      "kcxx=&skls=&skxq=&endJc=&skjc=&sfym=true&sfct=true&szjylb=&sfxx=true&skfs=",
    selectPath: "/jsxsd/xsxkkc/ggxxkxkOper",
    columns: [
      "kch",
      "kcmc",
      "xf",
      "skls",
      "sksj",
      "skdd",
      "xqmc",
      "xkrs",
      "syrs",
      "ctsm",
      "tsTskflMc",
      "czOper",
    ],
  };

  function isSupportedPage() {
    const href = location.href || "";
    return (
      href.includes("/jsxsd/") ||
      href.includes("comeInGgxxkxk") ||
      href.includes("xsxkkc")
    );
  }

  function getReferer() {
    return location.href.split("#")[0];
  }

  function buildQueryUrl() {
    return `${location.origin}${API.queryPath}?${API.queryString}`;
  }

  function parseHtmlErrorHint(html) {
    if (!html || html.charAt(0) !== "<") return null;
    if (/登录|login|session|timeout|超时|重新登录/i.test(html)) {
      return "会话可能已过期，请刷新页面重新登录后再运行脚本";
    }
    const alertMatch = html.match(/alert\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
    if (alertMatch) {
      return `服务器返回: ${alertMatch[1]}`;
    }
    if (/<!DOCTYPE|<html/i.test(html)) {
      return "服务器返回了 HTML 页面而非 JSON，请确认在公选课页面且已登录";
    }
    return null;
  }

  function parseQueryResponse(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("查询返回空响应");
    }
    if (trimmed.charAt(0) === "<") {
      throw new Error(parseHtmlErrorHint(trimmed) || trimmed.slice(0, 120));
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("查询返回非 JSON: " + trimmed.slice(0, 120));
    }
  }

  function buildQueryBody() {
    const p = new URLSearchParams();
    p.append("kcxx", "");
    p.append("skls", "");
    p.append("skxq", "");
    p.append("endJc", "");
    p.append("skjc", "");
    p.append("sfym", "true");
    p.append("sfct", "true");
    p.append("szjylb", "");
    p.append("sfxx", "true");
    p.append("skfs", "");
    p.append("sEcho", "1");
    p.append("iColumns", "12");
    p.append("sColumns", "");
    p.append("iDisplayStart", "0");
    p.append("iDisplayLength", "100");
    API.columns.forEach((col, i) => p.append(`mDataProp_${i}`, col));
    return p;
  }

  async function apiFetch(url, options = {}) {
    const referer = getReferer();
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
      Referer: referer,
      ...options.headers,
    };
    if (options.body instanceof URLSearchParams) {
      headers["Content-Type"] =
        "application/x-www-form-urlencoded; charset=UTF-8";
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
      referrer: referer,
      mode: "cors",
    });
  }

  let courseListCache = { data: null, at: 0 };
  let courseListQueryPromise = null;
  const COURSE_LIST_CACHE_MS = 300;

  async function queryCourseList(options = {}) {
    const { force = false } = options;
    const now = Date.now();
    if (
      !force &&
      courseListCache.data &&
      now - courseListCache.at < COURSE_LIST_CACHE_MS
    ) {
      return courseListCache.data;
    }

    if (courseListQueryPromise) {
      return courseListQueryPromise;
    }

    courseListQueryPromise = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = buildQueryUrl();
          const res = await apiFetch(url, {
            method: "POST",
            body: buildQueryBody(),
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
          }
          const data = parseQueryResponse(await res.text());
          const rowCount = (data.aaData || []).length;
          if (
            rowCount === 0 &&
            courseListCache.data &&
            (courseListCache.data.aaData || []).length > 0
          ) {
            throw new Error("查询返回空列表，疑似会话异常");
          }
          courseListCache = { data, at: Date.now() };
          return data;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
      }

      if (courseListCache.data) {
        log(`查询失败(${lastError?.message})，使用上一轮缓存`, "warning");
        return courseListCache.data;
      }
      throw lastError || new Error("查询课程列表失败");
    })();

    try {
      return await courseListQueryPromise;
    } finally {
      courseListQueryPromise = null;
    }
  }

  function findTeachingClassesInRows(allRows, courseCode) {
    const input = String(courseCode).trim();
    const filtered = allRows.filter((row) => rowMatchesCourseCode(row, input));
    return filtered.map((row) => courseRowToTeachingClass(row, courseCode));
  }

  function extractCourseIds(row) {
    const czOper = typeof row === "object" && !Array.isArray(row) ? row.czOper || "" : "";
    let kcid =
      row.kcid || row.kch_id || row.kchId || row.pkid || row.jx0404kcid || null;
    let jx0404id =
      row.jx0404id || row.skbjids || row.jxb_id || row.jx0404_id || null;

    const linkMatch = czOper.match(
      /ggxxkxkOper\?kcid=([^&"']+)[^"']*jx0404id=([^&"']+)/i,
    );
    const onclickMatch = czOper.match(
      /ggxxkxkOper\s*\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'([^']+)'/i,
    );
    const ids = linkMatch || onclickMatch;
    if (ids) {
      kcid = ids[1];
      jx0404id = ids[2];
    }

    if (!kcid && row && typeof row === "object") {
      const preferKeys = ["pkid", "kcid", "kch_id", "jx0404kcid", "rwid"];
      for (const key of preferKeys) {
        const val = row[key];
        if (typeof val === "string" && /^[0-9A-F]{32}$/i.test(val)) {
          kcid = val;
          break;
        }
      }
      if (!kcid) {
        for (const val of Object.values(row)) {
          if (
            typeof val === "string" &&
            /^[0-9A-F]{32}$/i.test(val) &&
            val !== jx0404id
          ) {
            kcid = val;
            break;
          }
        }
      }
    }

    return { kcid, jx0404id };
  }

  function normalizeCourseRow(row) {
    if (Array.isArray(row)) {
      return {
        kch: row[0] ?? "",
        kcmc: row[1] ?? "",
        skls: row[3] ?? "",
        sksj: row[4] ?? "",
        xkrs: row[7] ?? "0",
        syrs: row[8] ?? "0",
        czOper: row[11] ?? "",
      };
    }
    return row;
  }

  function parseCourseRows(data) {
    return (data.aaData || []).map((rawRow) => {
      const row = normalizeCourseRow(rawRow);
      const { kcid, jx0404id } = extractCourseIds(row);
      const czOper = row.czOper || "";
      const syrs = parseInt(row.syrs ?? "0", 10);
      const xkrs = row.xkrs ?? "0";

      return {
        kch: String(row.kch ?? "").trim(),
        kcmc: row.kcmc || row.ktmc || row.kcmc2 || "",
        xf: row.xf ?? row.kcxf ?? row.xfmc ?? "",
        skls: row.skls || row.skjsxm || row.jsmc || "",
        sksj: row.sksj || row.sksjms || "",
        xkrs,
        syrs,
        isAvailable: syrs > 0 && !/已满|不可选/i.test(czOper),
        kcid,
        jx0404id,
      };
    });
  }

  function rowMatchesCourseCode(row, input) {
    const code = String(input).trim();
    if (isCourseCode(code)) {
      return row.kch === code;
    }
    return (
      (row.kcmc && row.kcmc.includes(code)) ||
      (row.kch && row.kch.includes(code))
    );
  }

  function courseRowToTeachingClass(courseRow, courseCode) {
    const xkrsNum = parseInt(courseRow.xkrs || "0", 10);
    const total =
      xkrsNum + parseInt(courseRow.syrs || "0", 10) || xkrsNum;
    return {
      courseCode,
      info: {
        id: courseRow.jx0404id || courseRow.kcid || courseRow.kch,
        className: courseRow.kcmc || courseRow.kch,
        teacher: courseRow.skls || "未知教师",
        capacity:
          total > 0 ? `${courseRow.xkrs}/${total}` : `剩余${courseRow.syrs}`,
        timeInfo: courseRow.sksj || "未知时间",
        kcid: courseRow.kcid,
        jx0404id: courseRow.jx0404id,
        syrs: courseRow.syrs,
        xf: courseRow.xf,
        kch: courseRow.kch,
      },
    };
  }

  function parseSelectResult(data) {
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return { success: /成功/i.test(data), message: data.slice(0, 120) };
      }
    }
    return {
      success: data.success === true,
      message: data.message || data.msg || "",
      raw: data,
    };
  }

  async function selectCourseApi(kcid, jx0404id) {
    const qs = new URLSearchParams({
      kcid,
      cfbs: "null",
      jx0404id,
      xkzy: "",
      trjf: "",
    });
    const url = `${location.origin}${API.selectPath}?${qs}`;
    const res = await apiFetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`选课 HTTP ${res.status}`);
    }
    const text = await res.text();
    if (text.trim().charAt(0) === "<") {
      const hint = parseHtmlErrorHint(text);
      return { success: false, message: hint || "选课返回 HTML 而非 JSON" };
    }
    try {
      return parseSelectResult(JSON.parse(text));
    } catch {
      return parseSelectResult(text);
    }
  }

  // ========== 工具 ==========
  function safeParseFilterInput(input, separatorRegex = /[，,;；]+/) {
    if (!input || typeof input !== "string") return [];
    const raw = input.trim();
    if (!raw) return [];
    return safeFilter(
      safeMap(raw.split(separatorRegex), (item) => String(item).trim()),
      (v) => v && v.length > 0,
    );
  }

  function isCourseCode(input) {
    const value = String(input).trim();
    return /^[A-Za-z0-9_-]+$/.test(value) && /\d/.test(value);
  }

  function log(message, type = "info", courseCode = null) {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const courseTag = courseCode ? ` [${courseCode}]` : "";
    const prefix = `[抢课脚本 ${timestamp}]${courseTag}`;
    const colors = {
      info: "color: #4FC3F7",
      success: "color: #66BB6A",
      error: "color: #EF5350",
      warning: "color: #FFA726",
    };
    console.log(`%c${prefix} ${message}`, colors[type] || colors.info);
  }

  function initCourseState(courseCode) {
    courseStates.set(courseCode, {
      attempts: 0,
      failed: 0,
      tried: new Set(),
      conflicted: new Set(),
      selecting: false,
      success: false,
    });
  }

  function getCourseState(courseCode) {
    if (!courseStates.has(courseCode)) initCourseState(courseCode);
    return courseStates.get(courseCode);
  }

  function matchesTimeFilter(timeInfo, timeFilter) {
    if (!timeFilter || timeFilter.length === 0) return true;
    if (!timeInfo || timeInfo === "未知时间") return false;
    return timeFilter.some((keyword) => timeInfo.includes(keyword));
  }

  function matchesTeacherFilter(teacher, teacherFilter) {
    if (!teacherFilter || teacherFilter.length === 0) return true;
    if (!teacher || teacher === "未知教师") return false;
    return teacherFilter.some((keyword) => teacher.includes(keyword));
  }

  function matchesFilters(teachingClass, courseCode) {
    const courseConfig = TARGET_COURSES.find((c) => c.code === courseCode);
    const timeFilter =
      (courseConfig && courseConfig.timeFilter) || GLOBAL_TIME_FILTER;
    const teacherFilter =
      (courseConfig && courseConfig.teacherFilter) || GLOBAL_TEACHER_FILTER;

    if (!matchesTimeFilter(teachingClass.info.timeInfo, timeFilter)) {
      return { match: false, reason: "时间不匹配过滤条件" };
    }
    if (!matchesTeacherFilter(teachingClass.info.teacher, teacherFilter)) {
      return { match: false, reason: "教师不匹配过滤条件" };
    }
    return { match: true, reason: "通过过滤" };
  }

  function checkTeachingClassCapacity(teachingClass) {
    if (!teachingClass?.info) return false;
    const syrs = parseInt(teachingClass.info.syrs ?? "0", 10);
    return syrs > 0;
  }

  async function findAllTeachingClasses(courseCode) {
    const raw = await queryCourseList();
    const rows = parseCourseRows(raw);
    return findTeachingClassesInRows(rows, courseCode);
  }

  async function selectTeachingClass(teachingClass) {
    if (!teachingClass?.info?.kcid || !teachingClass?.info?.jx0404id) {
      return false;
    }

    const courseCode = teachingClass.courseCode;
    const classId = teachingClass.info.id;
    const state = getCourseState(courseCode);

    if (state.conflicted.has(classId) || state.tried.has(classId)) {
      return false;
    }

    state.selecting = true;
    state.tried.add(classId);

    try {
      log(
        `选课: ${teachingClass.info.className} (${teachingClass.info.teacher})`,
        "info",
        courseCode,
      );
      log(`时间: ${teachingClass.info.timeInfo}`, "info", courseCode);
      log(`容量: ${teachingClass.info.capacity}`, "info", courseCode);
      if (teachingClass.info.xf) {
        log(`学分: ${teachingClass.info.xf}`, "info", courseCode);
      }
      log(
        `参数: kcid=${teachingClass.info.kcid}, jx0404id=${teachingClass.info.jx0404id}`,
        "info",
        courseCode,
      );

      const result = await selectCourseApi(
        teachingClass.info.kcid,
        teachingClass.info.jx0404id,
      );

      if (result.success) {
        state.failed = 0;
        state.success = true;
        selectedCourses.add(courseCode);
        activeCourses.delete(courseCode);
        log(`🎊 选课成功: ${result.message}`, "success", courseCode);

        if (window.Notification && Notification.permission === "granted") {
          new Notification("抢课成功", {
            body: `${courseCode} ${teachingClass.info.className}`,
          });
        }
        courseListCache = { data: null, at: 0 };
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }

      if (/冲突/.test(result.message)) {
        state.conflicted.add(classId);
      }
      state.failed++;
      log(`选课失败: ${result.message}`, "error", courseCode);
      if (result.raw) {
        console.log("[选课原始响应]", result.raw);
      }
      courseListCache = { data: null, at: 0 };
      await new Promise((r) => setTimeout(r, 500));
      return false;
    } catch (error) {
      state.failed++;
      log(`选课异常: ${error.message}`, "error", courseCode);
      return false;
    } finally {
      state.selecting = false;
    }
  }

  async function attemptGrabSingleCourse(courseCode, allRows, totalRows = 0) {
    const state = getCourseState(courseCode);

    if (state.selecting || state.success || state.failed >= MAX_FAILED_ATTEMPTS) {
      return;
    }
    if (grabbingInProgress.has(courseCode)) return;

    grabbingInProgress.add(courseCode);
    state.attempts++;

    try {
      const teachingClasses = findTeachingClassesInRows(allRows, courseCode);
      if (teachingClasses.length === 0) {
        if (state.attempts === 1 || state.attempts % 20 === 0) {
          log(
            `列表中未找到 ${courseCode}（当前 ${totalRows} 条，请确认课程号在当前选课列表）`,
            "warning",
            courseCode,
          );
        }
        return;
      }

      let hasNonConflictedFullClass = false;

      for (const tc of teachingClasses) {
        if (!tc?.info?.id) continue;
        const classId = tc.info.id;
        if (state.conflicted.has(classId) || state.tried.has(classId)) continue;

        const filterResult = matchesFilters(tc, courseCode);
        if (!filterResult.match) continue;

        if (!checkTeachingClassCapacity(tc)) {
          hasNonConflictedFullClass = true;
          continue;
        }

        log(
          `🎯 发现有余量: ${tc.info.className} (剩余 ${tc.info.syrs ?? "?"})`,
          "success",
          courseCode,
        );

        await selectTeachingClass(tc);
        return;
      }

      if (
        !hasNonConflictedFullClass &&
        state.conflicted.size > 0 &&
        state.conflicted.size === teachingClasses.length
      ) {
        log("🛑 所有教学班均冲突，停止该课程", "error", courseCode);
        activeCourses.delete(courseCode);
      }

      if (state.attempts % 10 === 0 && state.tried.size > 0) {
        state.tried.clear();
      }
    } catch (error) {
      state.failed++;
      log(`处理异常: ${error.message}`, "error", courseCode);
    } finally {
      grabbingInProgress.delete(courseCode);
    }
  }

  let grabCycleInProgress = false;

  async function runGrabCycle() {
    if (grabCycleInProgress || !isRunning) return;
    grabCycleInProgress = true;

    try {
      attemptCount++;

      if (attemptCount > MAX_ATTEMPTS) {
        log(`已达到最大尝试次数 ${MAX_ATTEMPTS}，停止抢课`, "warning");
        stopGrabbing();
        return;
      }

      if (activeCourses.size === 0) {
        log("所有课程已完成", "success");
        stopGrabbing();
        return;
      }

      const raw = await queryCourseList();
      const allRows = parseCourseRows(raw);

      if (attemptCount === 1 || attemptCount % 10 === 0) {
        log(
          `第 ${attemptCount} 次轮询，列表 ${allRows.length} 条，监控 ${activeCourses.size} 门课`,
        );
      }

      const sortedCourses = Array.from(activeCourses).sort((a, b) => {
        const courseA = TARGET_COURSES.find((c) => c.code === a);
        const courseB = TARGET_COURSES.find((c) => c.code === b);
        return (courseA?.priority ?? 999) - (courseB?.priority ?? 999);
      });

      for (const courseCode of sortedCourses) {
        await attemptGrabSingleCourse(courseCode, allRows, allRows.length);
      }
    } catch (error) {
      log(`本轮查询失败: ${error.message}`, "error");
    } finally {
      grabCycleInProgress = false;
    }
  }

  function attemptGrabCourse() {
    runGrabCycle();
  }

  function startGrabbing(customCourses = null) {
    if (isRunning) {
      log("抢课脚本已在运行中！", "warning");
      return;
    }

    if (!isSupportedPage()) {
      log("❌ 请在东北电力教务选课页面 (/jsxsd/) 使用本脚本", "error");
      alert("请在东北电力大学教务系统选课页面使用本脚本！\n地址应包含 /jsxsd/");
      return;
    }

    const coursesToGrab = customCourses || TARGET_COURSES;
    if (!coursesToGrab?.length) {
      log("❌ 未配置目标课程", "error");
      alert('请先添加课程，或使用 grab.start([{code:"课程号", priority:1}])');
      return;
    }

    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }

    isRunning = true;
    attemptCount = 0;
    courseStates.clear();
    selectedCourses.clear();
    activeCourses.clear();

    for (const course of coursesToGrab) {
      const courseCode = typeof course === "string" ? course : course.code;
      activeCourses.add(courseCode);
      initCourseState(courseCode);
    }

    log(`🚀 开始监控 ${activeCourses.size} 门课程 (fetch 接口)`, "success");
    log(`📋 课程: ${Array.from(activeCourses).join(", ")}`, "info");
    log(`⏱️ 间隔: ${CHECK_INTERVAL}ms`, "info");

    queryCourseList({ force: true })
      .then((data) => {
        log(`预加载课程列表 ${parseCourseRows(data).length} 条`, "info");
      })
      .catch((e) => log(`预加载失败: ${e.message}`, "warning"));

    attemptGrabCourse();
    intervalId = setInterval(attemptGrabCourse, CHECK_INTERVAL);
  }

  function disposeGrabbingRuntime() {
    isRunning = false;

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (schedulerIntervalId) {
      clearInterval(schedulerIntervalId);
      schedulerIntervalId = null;
    }

    grabbingInProgress.clear();
    courseListCache = { data: null, at: 0 };
    courseListQueryPromise = null;
    grabCycleInProgress = false;
    scheduledTime = null;
    isScheduled = false;
    scheduleModeEnabled = false;

    const startBtn = document.getElementById("cg-start-btn");
    const stopBtn = document.getElementById("cg-stop-btn");
    const timerDisplay = document.getElementById("cg-timer-display");

    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (timerDisplay) timerDisplay.style.display = "none";
  }

  function stopGrabbing() {
    if (!isRunning && !isScheduled && !intervalId && !schedulerIntervalId) {
      log("抢课脚本未运行", "info");
      return;
    }
    disposeGrabbingRuntime();
    log("⏹️ 抢课脚本已停止", "warning");
  }

  function getStatus() {
    const status = {
      isRunning,
      attemptCount,
      activeCourses: Array.from(activeCourses),
      selectedCourses: Array.from(selectedCourses),
      checkInterval: CHECK_INTERVAL,
      maxAttempts: MAX_ATTEMPTS,
      concurrentMode: CONCURRENT_ENABLED,
      mode: "fetch",
    };
    console.table(status);
    return { status, courseStates: Array.from(courseStates.entries()) };
  }

  function addCourse(courseCode, priority = 999) {
    if (TARGET_COURSES.some((c) => c.code === courseCode)) {
      log(`课程 ${courseCode} 已存在`, "warning");
      return false;
    }
    TARGET_COURSES.push({ code: courseCode, priority });
    log(`✅ 已添加课程 ${courseCode}`, "success");
    return true;
  }

  function removeCourse(courseCode) {
    const index = TARGET_COURSES.findIndex((c) => c.code === courseCode);
    if (index === -1) {
      log(`课程 ${courseCode} 不在列表中`, "warning");
      return false;
    }
    TARGET_COURSES.splice(index, 1);
    activeCourses.delete(courseCode);
    courseStates.delete(courseCode);
    log(`🗑️ 已移除课程 ${courseCode}`, "warning");
    return true;
  }

  __CG_GLOBAL__[__CG_CLEANUP_KEY__] = (reason = "manual") => {
    disposeGrabbingRuntime();
    if (reason === "reload") {
      try {
        log("旧实例已清理", "warning");
      } catch (e) {}
    }
  };

  window.grab = {
    start: startGrabbing,
    stop: stopGrabbing,
    status: getStatus,
    addCourse,
    removeCourse,
    debug: async (courseCode = null) => {
      const codes = courseCode
        ? [courseCode]
        : TARGET_COURSES.map((c) => c.code);
      if (!codes.length) {
        log("没有课程", "warning");
        return null;
      }
      const debugInfo = [];
      for (const code of codes) {
        log(`--- ${code} ---`, "info");
        try {
          const classes = await findAllTeachingClasses(code);
          log(`找到 ${classes.length} 个教学班`, "info", code);
          for (const tc of classes) {
            log(
              `  ${tc.info.className} | 教师:${tc.info.teacher} | 剩余:${tc.info.syrs} | kcid:${tc.info.kcid}`,
              "info",
              code,
            );
            debugInfo.push({ courseCode: code, ...tc.info });
          }
        } catch (e) {
          log(`查询失败: ${e.message}`, "error", code);
        }
      }
      return debugInfo;
    },
    schedule: (timeString) => {
      const targetTime = new Date(timeString);
      if (isNaN(targetTime.getTime())) {
        log('时间格式错误，请用 "2025-12-19 14:00:00"', "error");
        return false;
      }
      setScheduledStart(targetTime);
      return true;
    },
    cancelSchedule: cancelScheduledStart,
    config: {
      getCourses: () => TARGET_COURSES,
      setCourses: (courses) => {
        TARGET_COURSES.length = 0;
        TARGET_COURSES.push(...courses);
      },
      getInterval: () => CHECK_INTERVAL,
      getConcurrentMode: () => CONCURRENT_ENABLED,
      getGlobalTimeFilter: () => GLOBAL_TIME_FILTER,
      getGlobalTeacherFilter: () => GLOBAL_TEACHER_FILTER,
      showFilters: () => {
        console.log("全局时间:", GLOBAL_TIME_FILTER.join(", ") || "无");
        console.log("全局教师:", GLOBAL_TEACHER_FILTER.join(", ") || "无");
      },
    },
  };

  console.log(
    "%c🎓 东北电力抢课脚本已加载 (fetch 接口模式)",
    "color: #ff6b35; font-size: 16px; font-weight: bold;",
  );
  console.log("  grab.start()  开始抢课");
  console.log("  grab.stop()   停止");
  console.log('  grab.debug("课程号")  查看接口数据');
  if (!isSupportedPage()) {
    console.warn("⚠️ 当前页面不是 /jsxsd/ 选课页，请进入公选课页面后再 start");
  }
  // ========== UI界面 ==========
  // 创建UI控制面板
  function createUI() {
    // 检查是否已存在UI
    if (document.getElementById("courseGrabberUI")) {
      return;
    }

    // 创建样式
    const style = document.createElement("style");
    style.textContent = `
            #courseGrabberUI {
                --cg-ink: #071a2d;
                --cg-surface: #0c243a;
                --cg-surface-raised: #112e47;
                --cg-surface-quiet: #0a2034;
                --cg-border: #2a4b66;
                --cg-text: #f5f2e9;
                --cg-muted: #a8b8c6;
                --cg-success: #42d6a4;
                --cg-warning: #f3b64d;
                --cg-danger: #e75d64;
                --cg-focus: #8ad9ff;
                position: fixed;
                top: 20px;
                right: 20px;
                width: min(440px, calc(100vw - 32px));
                max-height: min(90vh, 760px);
                background: var(--cg-ink);
                border: 1px solid var(--cg-border);
                border-radius: 18px;
                box-shadow: 0 24px 70px rgba(4, 15, 27, 0.42), 0 2px 0 rgba(255, 255, 255, 0.05) inset;
                z-index: 999999;
                font-family: "Avenir Next", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                color: var(--cg-text);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            #courseGrabberUI * {
                box-sizing: border-box;
            }
            .cg-header {
                padding: 15px 16px;
                background: #081e32;
                border-bottom: 1px solid var(--cg-border);
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                user-select: none;
            }
            .cg-title {
                font-size: 16px;
                font-weight: 700;
                letter-spacing: 0.04em;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cg-controls {
                display: flex;
                gap: 6px;
            }
            .cg-close,
            .cg-minimize {
                background: #173750;
                border: 1px solid #31536c;
                color: var(--cg-text);
                width: 30px;
                height: 30px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 17px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
            }
            .cg-close:hover {
                background: #5a2632;
                border-color: var(--cg-danger);
                transform: rotate(90deg);
            }
            .cg-minimize:hover {
                background: #24506e;
                border-color: var(--cg-focus);
            }
            .cg-body {
                padding: 14px;
                overflow-y: auto;
                flex: 1;
                scrollbar-color: #496780 transparent;
            }
            .cg-section {
                background: var(--cg-surface-raised);
                border: 1px solid #244660;
                border-radius: 12px;
                padding: 13px;
                margin-bottom: 12px;
                box-shadow: 0 1px 0 rgba(255, 255, 255, 0.035) inset;
            }
            .cg-section:last-child {
                margin-bottom: 0;
            }
            .cg-section-title {
                color: var(--cg-text);
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.07em;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .cg-input {
                width: 100%;
                padding: 10px 11px;
                border: 1px solid #365873;
                background: var(--cg-surface-quiet);
                border-radius: 8px;
                color: var(--cg-text);
                font-size: 13px;
                margin-bottom: 8px;
                transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
            }
            .cg-input:hover {
                border-color: #58809d;
            }
            .cg-input:focus {
                outline: none;
                border-color: var(--cg-focus);
                background: #0d2940;
                box-shadow: 0 0 0 3px rgba(138, 217, 255, 0.16);
            }
            .cg-input::placeholder {
                color: #8398aa;
            }
            .cg-btn {
                min-height: 36px;
                padding: 9px 13px;
                border: 1px solid transparent;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 0.01em;
                transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                justify-content: center;
            }
            .cg-btn:hover:not(:disabled) {
                transform: translateY(-1px);
            }
            .cg-btn:disabled {
                cursor: not-allowed;
                opacity: 0.48;
            }
            .cg-btn-primary {
                background: var(--cg-success);
                border-color: #68e4ba;
                color: #06261f;
                box-shadow: 0 7px 18px rgba(66, 214, 164, 0.16);
            }
            .cg-btn-primary:hover:not(:disabled) {
                background: #66e1b7;
                box-shadow: 0 9px 20px rgba(66, 214, 164, 0.25);
            }
            .cg-btn-danger {
                background: #9e3d49;
                border-color: #d55a63;
                color: #fff7f5;
            }
            .cg-btn-danger:hover:not(:disabled) {
                background: var(--cg-danger);
            }
            .cg-btn-secondary {
                background: #173a55;
                border-color: #315873;
                color: #dfeaf0;
            }
            .cg-btn-secondary:hover:not(:disabled) {
                background: #24516f;
                border-color: #56809d;
            }
            .cg-btn-small {
                min-height: 32px;
                padding: 6px 10px;
                font-size: 12px;
            }
            .cg-btn-group {
                display: flex;
                gap: 8px;
                margin-top: 10px;
            }
            .cg-course-list {
                max-height: 220px;
                overflow-y: auto;
                margin-top: 10px;
                scrollbar-color: #496780 transparent;
            }
            .cg-course-item {
                background: #0d2941;
                border: 1px solid #284c68;
                padding: 11px;
                border-radius: 9px;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                transition: background-color 160ms ease, border-color 160ms ease;
            }
            .cg-course-item:last-child {
                margin-bottom: 0;
            }
            .cg-course-item:hover {
                background: #11334f;
                border-color: #4e7795;
            }
            .cg-course-info {
                flex: 1;
                min-width: 0;
                font-size: 13px;
            }
            .cg-course-code {
                color: var(--cg-text);
                font-weight: 700;
                margin-bottom: 5px;
                overflow-wrap: anywhere;
            }
            .cg-course-meta {
                color: var(--cg-muted);
                font-size: 11px;
            }
            .cg-status {
                padding: 10px 11px;
                background: #0c2b40;
                border: 1px solid #28536a;
                border-radius: 8px;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cg-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--cg-success);
                box-shadow: 0 0 0 4px rgba(66, 214, 164, 0.13);
                animation: cg-pulse 2s infinite;
            }
            @keyframes cg-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .cg-log-area {
                background: #061827;
                border: 1px solid #203f57;
                border-radius: 8px;
                padding: 11px;
                max-height: 168px;
                overflow-y: auto;
                color: #d5e1e8;
                font-size: 11px;
                font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
                line-height: 1.65;
                scrollbar-color: #496780 transparent;
            }
            .cg-log-item {
                margin-bottom: 4px;
            }
            .cg-log-success { color: var(--cg-success); }
            .cg-log-error { color: #ff8c91; }
            .cg-log-warning { color: var(--cg-warning); }
            .cg-log-info { color: #86d5ff; }
            .cg-badge {
                display: inline-block;
                padding: 3px 7px;
                background: #1d4059;
                border: 1px solid #3b647e;
                border-radius: 999px;
                color: #d7e6ee;
                font-size: 11px;
                margin-left: 6px;
            }
            .cg-badge-success {
                background: rgba(66, 214, 164, 0.16);
                border-color: rgba(66, 214, 164, 0.45);
                color: #9bf0cf;
            }
            .cg-badge-running {
                background: rgba(66, 214, 164, 0.16);
                border: 1px solid rgba(66, 214, 164, 0.45);
                border-radius: 999px;
                color: #9bf0cf;
                padding: 3px 8px;
            }
            .cg-minimized {
                height: auto !important;
                width: 112px !important;
            }
            .cg-minimized .cg-body,
            .cg-minimized .cg-title {
                display: none !important;
            }
            .cg-filter-input {
                font-size: 12px;
                margin-bottom: 4px;
            }
            .cg-help-text {
                color: var(--cg-muted);
                font-size: 11px;
                line-height: 1.5;
                margin-top: 4px;
            }
            .cg-timer-display {
                background: #3d2e16;
                border: 1px solid #9e7132;
                color: #ffe0a4;
                padding: 14px;
                border-radius: 8px;
                text-align: center;
                font-size: 24px;
                font-weight: 700;
                letter-spacing: 0.08em;
                margin-top: 10px;
                font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
            }
            .cg-timer-active {
                background: #4a3516;
                animation: cg-timer-pulse 2s infinite;
            }
            @keyframes cg-timer-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(243, 182, 77, 0.14); }
                50% { box-shadow: 0 0 0 8px rgba(243, 182, 77, 0); }
            }
            .cg-time-input-group {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .cg-time-input-group input {
                flex: 1;
            }
            .cg-course-filters {
                background: #0a2135;
                border-left: 2px solid #3f6e8d;
                padding: 8px;
                border-radius: 0 6px 6px 0;
                margin-top: 7px;
                font-size: 11px;
            }
            .cg-course-filter-item {
                color: #c3d1da;
                margin-bottom: 4px;
                display: flex;
                align-items: center;
                gap: 4px;
                overflow-wrap: anywhere;
            }
            .cg-course-filter-item:last-child {
                margin-bottom: 0;
            }
            .cg-filter-label {
                color: #93acc0;
                min-width: 40px;
            }
            .cg-course-actions {
                display: flex;
                gap: 4px;
                flex-direction: column;
            }
            #courseGrabberUI button:focus-visible,
            #courseGrabberUI input:focus-visible {
                outline: 2px solid var(--cg-focus);
                outline-offset: 2px;
            }
            @media (max-width: 520px) {
                #courseGrabberUI {
                    top: 12px;
                    right: 12px;
                    width: calc(100vw - 24px);
                    max-height: calc(100vh - 24px);
                    border-radius: 14px;
                }
                .cg-header {
                    padding: 12px;
                }
                .cg-body {
                    padding: 10px;
                }
                .cg-section {
                    padding: 11px;
                    margin-bottom: 10px;
                }
                .cg-course-item {
                    align-items: flex-start;
                }
                .cg-course-actions {
                    flex-direction: row;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                #courseGrabberUI *,
                #courseGrabberUI *::before,
                #courseGrabberUI *::after {
                    animation-duration: 0.01ms !important;
                    animation-iteration-count: 1 !important;
                    scroll-behavior: auto !important;
                    transition-duration: 0.01ms !important;
                }
            }
        `;
    document.head.appendChild(style);

    // 创建UI容器
    const ui = document.createElement("div");
    ui.id = "courseGrabberUI";
    ui.innerHTML = `
            <div class="cg-header">
                <div class="cg-title">
                    <span>🎓</span>
                    <span>东北电力抢课</span>
                </div>
                <div class="cg-controls">
                    <button class="cg-minimize" id="cg-minimize-btn" title="最小化">−</button>
                    <button class="cg-close" id="cg-close-btn" title="关闭">×</button>
                </div>
            </div>
            <div class="cg-body">
                <!-- 状态显示 -->
                <div class="cg-section">
                    <div class="cg-section-title">📊 运行状态</div>
                    <div id="cg-status-display">
                        <div class="cg-status">
                            <span>状态:</span>
                            <span id="cg-status-text">未运行</span>
                        </div>
                    </div>
                </div>

                <!-- 课程管理 -->
                <div class="cg-section">
                    <div class="cg-section-title">📚 添加目标课程</div>
                    <input type="text" class="cg-input" id="cg-course-code" placeholder="课程号 (例: 063130090)">
                    <input type="number" class="cg-input" id="cg-course-priority" placeholder="优先级 (数字越小优先级越高)" value="1" min="1">
                    
                    <div class="cg-section-title" style="font-size: 13px; margin-top: 12px; margin-bottom: 8px;"> 目标课程的过滤器 (可选)</div>
                    <input type="text" class="cg-input cg-filter-input" id="cg-time-filter" placeholder="时间过滤 (例: 星期一,第1-2节)">
                    <div class="cg-help-text">多个关键词用逗号分隔，满足任意一个即可</div>
                    <input type="text" class="cg-input cg-filter-input" id="cg-teacher-filter" placeholder="教师过滤 (例: 张三,讲师)">
                    <div class="cg-help-text">支持教师姓名，满足任意一个即可</div>

                    <button class="cg-btn cg-btn-secondary cg-btn-small" id="cg-add-course" style="width: 100%; margin-top: 12px;">➕ 添加课程</button>
                </div>

                <!-- 目标课程列表 -->
                <div class="cg-section">
                    <div class="cg-section-title">📋 目标课程列表</div>
                    <div class="cg-course-list" id="cg-course-list"></div>
                </div>

                <!-- 定时开抢 -->
                <div class="cg-section">
                    <div class="cg-section-title">⏰ 定时开抢</div>
                    <div class="cg-time-input-group">
                        <input type="datetime-local" class="cg-input" id="cg-schedule-time" placeholder="选择开抢时间" disabled>
                        <button class="cg-btn cg-btn-secondary cg-btn-small" id="cg-schedule-toggle-btn">开启定时</button>
                    </div>
                    <div class="cg-help-text" id="cg-schedule-help">默认关闭定时模式；开启后才允许设置自动开抢时间</div>
                    <div id="cg-timer-display" style="display: none;"></div>
                </div>

                <!-- 控制按钮 -->
                <div class="cg-section">
                    <div class="cg-btn-group">
                        <button class="cg-btn cg-btn-primary" id="cg-start-btn" style="flex: 1;">🚀 开始抢课</button>
                        <button class="cg-btn cg-btn-danger" id="cg-stop-btn" style="flex: 1;" disabled>⏹️ 停止</button>
                    </div>
                    <div class="cg-btn-group">
                        <button class="cg-btn cg-btn-secondary cg-btn-small" id="cg-status-btn" style="flex: 1;">📊 查看状态</button>
                        <button class="cg-btn cg-btn-secondary cg-btn-small" id="cg-debug-btn" style="flex: 1;">🔍 调试</button>
                    </div>
                </div>

                <!-- 日志显示 -->
                <div class="cg-section">
                    <div class="cg-section-title">📝 运行日志</div>
                    <div class="cg-log-area" id="cg-log-area"></div>
                </div>
            </div>
        `;

    document.body.appendChild(ui);

    // 添加拖拽功能
    makeDraggable(ui);

    // 绑定事件
    bindUIEvents();

    // 初始化课程列表
    updateCourseList();

    // 劫持日志函数以显示在UI中
    interceptLogs();

    console.log(
      "%c✨ UI界面已加载！可拖动面板到任意位置",
      "color: #43e97b; font-weight: bold; font-size: 14px;",
    );
  }

  // 使UI可拖拽
  function makeDraggable(element) {
    const header = element.querySelector(".cg-header");
    let pos1 = 0,
      pos2 = 0,
      pos3 = 0,
      pos4 = 0;

    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = element.offsetTop - pos2 + "px";
      element.style.left = element.offsetLeft - pos1 + "px";
      element.style.right = "auto";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // 绑定UI事件
  function bindUIEvents() {
    // 关闭按钮
    document.getElementById("cg-close-btn").onclick = () => {
      document.getElementById("courseGrabberUI").style.display = "none";
    };

    // 最小化按钮
    document.getElementById("cg-minimize-btn").onclick = () => {
      const ui = document.getElementById("courseGrabberUI");
      ui.classList.toggle("cg-minimized");
      const btn = document.getElementById("cg-minimize-btn");
      btn.textContent = ui.classList.contains("cg-minimized") ? "□" : "−";
    };

    const scheduleTimeInput = document.getElementById("cg-schedule-time");
    const scheduleToggleBtn = document.getElementById("cg-schedule-toggle-btn");
    const scheduleHelp = document.getElementById("cg-schedule-help");

    const syncScheduleUI = () => {
      if (!scheduleTimeInput || !scheduleToggleBtn) return;
      scheduleTimeInput.disabled = !scheduleModeEnabled;
      scheduleToggleBtn.textContent = scheduleModeEnabled ? "关闭定时" : "开启定时";
      scheduleHelp.textContent = scheduleModeEnabled
        ? "定时模式已开启：设置时间后，到点自动开始抢课"
        : "默认关闭定时模式；开启后才允许设置自动开抢时间";
    };

    syncScheduleUI();

    if (scheduleToggleBtn) {
      scheduleToggleBtn.onclick = () => {
        scheduleModeEnabled = !scheduleModeEnabled;
        if (!scheduleModeEnabled) {
          cancelScheduledStart();
        } else {
          addUILog("info", "已开启定时模式");
          log("已开启定时模式", "info");
        }
        syncScheduleUI();
      };
    }

    // 添加课程
    document.getElementById("cg-add-course").onclick = () => {
      const code = document.getElementById("cg-course-code").value.trim();
      const priority =
        parseInt(document.getElementById("cg-course-priority").value) || 1;

      if (!code) {
        alert("请输入课程号！");
        return;
      }

      // 检查是否已存在
      if (TARGET_COURSES.some((c) => c.code === code)) {
        alert("该课程已存在！");
        return;
      }

      // 获取替换课程和过滤器（使用querySelector作为备用方案）
      const timeFilterEl = document.getElementById("cg-time-filter");
      const teacherFilterEl = document.getElementById("cg-teacher-filter");

      const timeFilterInput = (timeFilterEl ? timeFilterEl.value : "").trim();
      const teacherFilterInput = (
        teacherFilterEl ? teacherFilterEl.value : ""
      ).trim();

      const finalCourse = { code: code, priority: priority };

      // 使用安全的解析函数处理过滤器输入（避免被篡改的 Array.prototype.filter）
      const finalTimeFilter = safeParseFilterInput(timeFilterInput);
      if (finalTimeFilter.length > 0) {
        finalCourse.timeFilter = finalTimeFilter;
      }

      const finalTeacherFilter = safeParseFilterInput(teacherFilterInput);
      if (finalTeacherFilter.length > 0) {
        finalCourse.teacherFilter = finalTeacherFilter;
      }

      // 直接推入 finalCourse（是新对象）
      TARGET_COURSES.push(finalCourse);

      // 清空所有输入
      document.getElementById("cg-course-code").value = "";
      document.getElementById("cg-course-priority").value = "1";
      document.getElementById("cg-time-filter").value = "";
      document.getElementById("cg-teacher-filter").value = "";

      updateCourseList();

      let logMsg = `已添加课程: ${code} (优先级: ${priority})`;
      if (finalCourse.timeFilter && finalCourse.timeFilter.length > 0) {
        logMsg += ` [时间过滤: ${finalCourse.timeFilter.join(", ")}]`;
      }
      if (finalCourse.teacherFilter && finalCourse.teacherFilter.length > 0) {
        logMsg += ` [教师过滤: ${finalCourse.teacherFilter.join(", ")}]`;
      }
      addUILog("success", logMsg);
    };

    // 开始抢课
    document.getElementById("cg-start-btn").onclick = () => {
      if (TARGET_COURSES.length === 0) {
        alert("请先添加至少一门课程！");
        return;
      }

      if (scheduleModeEnabled && scheduleTimeInput && scheduleTimeInput.value) {
        const scheduleTime = new Date(scheduleTimeInput.value);
        if (!isNaN(scheduleTime.getTime()) && scheduleTime > new Date()) {
          setScheduledStart(scheduleTime);
          document.getElementById("cg-start-btn").disabled = true;
          document.getElementById("cg-stop-btn").disabled = false;
          updateStatusDisplay();
          return;
        }
      }

      window.grab.start();
      document.getElementById("cg-start-btn").disabled = true;
      document.getElementById("cg-stop-btn").disabled = false;
      updateStatusDisplay();
    };

    // 停止抢课
    document.getElementById("cg-stop-btn").onclick = () => {
      window.grab.stop();
      document.getElementById("cg-start-btn").disabled = false;
      document.getElementById("cg-stop-btn").disabled = true;
      updateStatusDisplay();
    };

    // 查看状态
    document.getElementById("cg-status-btn").onclick = () => {
      window.grab.status();
    };

    // 调试
    document.getElementById("cg-debug-btn").onclick = () => {
      window.grab.debug();
    };

    // 定时模式按钮已改为开关按钮；不再直接绑定“确定”动作

    // 定期更新状态
    setInterval(updateStatusDisplay, 1000);
  }

  // 更新课程列表显示
  function updateCourseList() {
    const list = document.getElementById("cg-course-list");
    if (TARGET_COURSES.length === 0) {
      list.innerHTML =
        '<div style="text-align: center; opacity: 0.6; padding: 20px;">暂无课程，请先添加课程</div>';
      return;
    }

    list.innerHTML = TARGET_COURSES.map((course, index) => {
      const hasConfig = course.timeFilter || course.teacherFilter;

      let filterHTML = "";
      if (hasConfig) {
        filterHTML = '<div class="cg-course-filters">';
        if (course.timeFilter) {
          filterHTML += `<div class="cg-course-filter-item"><span class="cg-filter-label">⏰ 时间:</span><span>${course.timeFilter.join(", ")}</span></div>`;
        }
        if (course.teacherFilter) {
          filterHTML += `<div class="cg-course-filter-item"><span class="cg-filter-label">👨‍🏫 教师:</span><span>${course.teacherFilter.join(", ")}</span></div>`;
        }
        filterHTML += "</div>";
      } else {
        filterHTML =
          '<div class="cg-course-meta" style="opacity: 0.6;">🔓 无配置</div>';
      }

      return `
                <div class="cg-course-item">
                    <div class="cg-course-info">
                        <div class="cg-course-code">${course.code} <span class="cg-badge">优先级: ${course.priority}</span></div>
                        ${filterHTML}
                    </div>
                    <div class="cg-course-actions">
                        <button class="cg-btn cg-btn-secondary cg-btn-small" onclick="window.editCourseUI(${index})" title="编辑过滤器">✏️</button>
                        <button class="cg-btn cg-btn-danger cg-btn-small" onclick="window.removeCourseUI(${index})" title="删除课程">🗑️</button>
                    </div>
                </div>
            `;
    }).join("");
  }

  // 删除课程（UI调用）
  window.removeCourseUI = (index) => {
    const course = TARGET_COURSES[index];
    if (confirm(`确定要删除课程 ${course.code} 吗？`)) {
      TARGET_COURSES.splice(index, 1);
      updateCourseList();
      addUILog("warning", `已删除课程: ${course.code}`);
    }
  };

  // 编辑课程过滤器（UI调用）
  window.editCourseUI = (index) => {
    const course = TARGET_COURSES[index];

    const timeFilter = prompt(
      `编辑课程 ${course.code} 的时间过滤器\n\n多个关键词用逗号分隔，留空表示不过滤\n例如: 星期一,第1-2节`,
      course.timeFilter ? course.timeFilter.join(",") : "",
    );

    if (timeFilter === null) return; // 用户取消

    const teacherFilter = prompt(
      `编辑课程 ${course.code} 的教师过滤器\n\n多个关键词用逗号分隔，留空表示不过滤\n例如: 张三,讲师`,
      course.teacherFilter ? course.teacherFilter.join(",") : "",
    );

    if (teacherFilter === null) return;

    const parsedTimeFilter = safeParseFilterInput(timeFilter);
    if (parsedTimeFilter.length > 0) {
      course.timeFilter = parsedTimeFilter;
    } else {
      delete course.timeFilter;
    }

    const parsedTeacherFilter = safeParseFilterInput(teacherFilter);
    if (parsedTeacherFilter.length > 0) {
      course.teacherFilter = parsedTeacherFilter;
    } else {
      delete course.teacherFilter;
    }

    updateCourseList();
    addUILog("info", `已更新课程 ${course.code} 的过滤器`);
  };

  // 更新状态显示
  function updateStatusDisplay() {
    const statusText = document.getElementById("cg-status-text");

    if (statusText) {
      if (isRunning) {
        statusText.innerHTML = '<span class="cg-status-dot"></span>运行中';
        statusText.className = "cg-badge-running";
      } else {
        statusText.textContent = "未运行";
        statusText.className = "";
      }
    }
  }

  // 添加UI日志
  function addUILog(type, message) {
    const logArea = document.getElementById("cg-log-area");
    if (!logArea) return;

    const time = new Date().toLocaleTimeString();
    const logItem = document.createElement("div");
    logItem.className = `cg-log-item cg-log-${type}`;
    logItem.textContent = `[${time}] ${message}`;

    logArea.appendChild(logItem);
    logArea.scrollTop = logArea.scrollHeight;

    // 限制日志数量
    while (logArea.children.length > 100) {
      logArea.removeChild(logArea.firstChild);
    }
  }

  // 劫持日志函数
  function interceptLogs() {
    const originalLog = log;
    window.log = function (message, type = "info", courseCode = null) {
      originalLog(message, type, courseCode);
      const prefix = courseCode ? `[${courseCode}] ` : "";
      addUILog(type, prefix + message);
    };
  }

  // 设置定时开抢
  function setScheduledStart(targetTime) {
    // 取消之前的定时器
    if (schedulerIntervalId) {
      clearInterval(schedulerIntervalId);
    }

    scheduledTime = targetTime;
    isScheduled = true;

    // 显示倒计时
    const timerDisplay = document.getElementById("cg-timer-display");
    timerDisplay.style.display = "block";
    timerDisplay.className = "cg-timer-display cg-timer-active";

    // 禁用立即开始按钮
    document.getElementById("cg-start-btn").disabled = true;
    const scheduleToggleBtn = document.getElementById("cg-schedule-toggle-btn");
    if (scheduleToggleBtn) {
      scheduleToggleBtn.textContent = "❌ 取消定时";
      scheduleToggleBtn.onclick = cancelScheduledStart;
    }

    addUILog("info", `已设置定时开抢: ${targetTime.toLocaleString()}`);
    log(
      `⏰ 定时开抢已设置，将在 ${targetTime.toLocaleString()} 自动开始`,
      "success",
    );

    // 启动倒计时
    schedulerIntervalId = setInterval(() => {
      const now = new Date();
      const diff = scheduledTime - now;

      if (diff <= 0) {
        // 时间到，开始抢课
        clearInterval(schedulerIntervalId);
        isScheduled = false;
        timerDisplay.style.display = "none";

        addUILog("success", "⏰ 定时时间已到，开始抢课！");
        log("⏰ 定时时间已到，自动开始抢课！", "success");

        // 重置按钮
        const scheduleToggleBtn = document.getElementById("cg-schedule-toggle-btn");
        if (scheduleToggleBtn) {
          scheduleToggleBtn.textContent = "开启定时";
          scheduleModeEnabled = false;
        }

        window.grab.start();
        document.getElementById("cg-start-btn").disabled = true;
        document.getElementById("cg-stop-btn").disabled = false;
      } else {
        // 更新倒计时显示
        updateCountdown(diff);
      }
    }, 100);
  }

  // 取消定时开抢
  function cancelScheduledStart() {
    if (schedulerIntervalId) {
      clearInterval(schedulerIntervalId);
    }

    scheduledTime = null;
    isScheduled = false;

    const timerDisplay = document.getElementById("cg-timer-display");
    timerDisplay.style.display = "none";

    document.getElementById("cg-start-btn").disabled = false;
    scheduleModeEnabled = false;
    const scheduleToggleBtn = document.getElementById("cg-schedule-toggle-btn");
    const scheduleTimeInput = document.getElementById("cg-schedule-time");
    if (scheduleToggleBtn) {
      scheduleToggleBtn.textContent = "开启定时";
    }
    if (scheduleTimeInput) {
      scheduleTimeInput.disabled = true;
    }

    addUILog("warning", "已取消定时开抢");
    log("⏰ 定时开抢已取消", "warning");
  }

  // 更新倒计时显示
  function updateCountdown(milliseconds) {
    const timerDisplay = document.getElementById("cg-timer-display");
    if (!timerDisplay) return;

    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ms = Math.floor((milliseconds % 1000) / 10);

    let timeString = "";
    if (hours > 0) {
      timeString = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    } else {
      timeString = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
    }

    timerDisplay.textContent = `⏰ ${timeString}`;

    // 最后10秒加速闪烁
    if (totalSeconds <= 10 && totalSeconds > 0) {
      timerDisplay.style.animation = "timerPulse 0.5s infinite";
    }
  }

  // 自动创建UI
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createUI);
  } else {
    createUI();
  }

  // 提供手动显示UI的方法
  window.showGrabberUI = () => {
    const ui = document.getElementById("courseGrabberUI");
    if (ui) {
      ui.style.display = "flex";
    } else {
      createUI();
    }
  };
})();


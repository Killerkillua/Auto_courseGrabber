/**
 * ============================================================
 * 抢课脚本 fetch 改造方案
 * 适用系统：东北电力大学教务系统 (jwxt.neepu.edu.cn)
 * 基于截图分析的功能结构进行改造
 * ============================================================
 *
 * 使用说明：
 * 本文件是改造方案参考，不是直接可运行的完整脚本。
 * 你需要：
 *   1. 先完成"抓包步骤"记录你的接口地址和参数
 *   2. 将对应代码块替换到你现有脚本中
 *   3. 根据实际接口返回值调整解析逻辑
 */

// ============================================================
// 第零步：抓包 —— 获取真实的接口地址和参数
// ============================================================
/*
 * 操作步骤：
 * 1. 打开教务系统，按 F12 打开开发者工具
 * 2. 切换到 Network（网络）标签页
 * 3. 勾选 "Preserve log"（保留日志）
 * 4. 清空现有日志（点击 🚫 图标）
 * 5. 手动做一次"查询课程"操作
 *    → 在 Network 中找到类似 GET /jwxt/student/course/list?... 的请求
 *    → 右键 → Copy → Copy as fetch
 *    → 粘贴到记事本，这就是"查询课程接口"
 * 6. 手动做一次"选课"操作
 *    → 在 Network 中找到类似 POST /jwxt/student/course/select 的请求
 *    → 右键 → Copy → Copy as fetch
 *    → 粘贴到记事本，这就是"选课接口"
 * 7. 手动做一次"退课"操作（在账号A上）
 *    → 同样的方法，记录退课接口
 *
 * 把下面三个接口的 fetch 格式记下来，填入对应位置：
 */

// ============================================================
// 第一部分：接口配置 —— 把你抓到的接口填到这里
// ============================================================

const API_CONFIG = {
    // ===== 查询课程接口（替换成你抓到的）=====
    // 示例：GET /jwxt/student/course/list?keyword=xxx&semester=2025-2026-1
    queryCourse: {
      url: '/jwxt/student/course/list',           // ← 改成你的
      method: 'GET',
      // 构建查询参数
      buildParams: function(courseCode) {
        return new URLSearchParams({
          keyword: courseCode,                     // ← 改成你的参数名
          // semester: '2025-2026-1',              // ← 按需添加
        }).toString();
      }
    },
  
    // ===== 选课接口（替换成你抓到的）=====
    // 示例：POST /jwxt/student/course/select
    selectCourse: {
      url: '/jwxt/student/course/select',          // ← 改成你的
      method: 'POST',
      // 构建请求体
      buildBody: function(courseCode) {
        // 常见格式 1: URLSearchParams
        const params = new URLSearchParams();
        params.append('courseCode', courseCode);   // ← 改成你的参数名
        // params.append('classId', 'xxx');        // ← 按需添加班级ID
        return params;
      }
    },
  
    // ===== 退课接口（替换成你抓到的）=====
    // 示例：POST /jwxt/student/course/drop
    dropCourse: {
      url: '/jwxt/student/course/drop',            // ← 改成你的
      method: 'POST',
      buildBody: function(courseCode) {
        const params = new URLSearchParams();
        params.append('courseCode', courseCode);   // ← 改成你的参数名
        return params;
      }
    },
  
    // ===== 轮询间隔（毫秒）=====
    pollInterval: 150,  // 150ms 一个循环，可根据网络情况调整
  };
  
  
  // ============================================================
  // 第二部分：CSRF Token 处理 —— 教务系统常见反爬手段
  // ============================================================
  
  /**
   * 从页面中提取 CSRF Token
   * 很多教务系统（如正方教务）会在页面中嵌入 token 用于校验
   *
   * 常见位置：
   *   - <meta name="csrf-token" content="xxx">
   *   - <input type="hidden" name="_token" value="xxx">
   *   - <script>var token = "xxx";</script>
   *
   * 在 Network 中检查你抓到的请求头，如果有一个类似 X-CSRF-TOKEN
   * 或 _token 的字段，说明需要提取它。
   */
  function getCSRFToken() {
    // 方式1: 从 meta 标签
    const metaToken = document.querySelector('meta[name="csrf-token"]');
    if (metaToken) return metaToken.getAttribute('content');
  
    // 方式2: 从隐藏 input
    const inputToken = document.querySelector('input[name="_token"]');
    if (inputToken) return inputToken.value;
  
    // 方式3: 从 script 中正则提取
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const match = s.textContent.match(/var\s+token\s*=\s*["']([^"']+)["']/);
      if (match) return match[1];
    }
  
    // 如果都没有，说明不需要 token
    return null;
  }
  
  
  // ============================================================
  // 第三部分：核心 fetch 请求封装
  // ============================================================
  
  /**
   * 通用 fetch 封装，自动处理：
   *   - CSRF Token 注入
   *   - Cookie 自动携带
   *   - 超时控制
   *   - 错误统一处理
   */
  async function fetchWithAuth(url, options = {}) {
    const token = getCSRFToken();
  
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',  // 模拟 AJAX 请求
      ...options.headers,
    };
  
    // 如果有 CSRF token，注入
    if (token) {
      headers['X-CSRF-TOKEN'] = token;        // ← 改成你的 header 名
    }
  
    // 如果是 POST 且 body 是 URLSearchParams，设置 Content-Type
    if (options.body instanceof URLSearchParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10秒超时
  
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',  // 自动携带 Cookie
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  
  
  // ============================================================
  // 第四部分：查询课程状态（替代 DOM 解析）
  // ============================================================
  
  /**
   * 查询课程当前状态
   * 返回: { isAvailable: boolean, courseName: string, quota: number, ... }
   *
   * 注意：解析逻辑需要根据你抓到的实际返回值调整！
   */
  async function queryCourseStatus(courseCode) {
    const config = API_CONFIG.queryCourse;
    const params = config.buildParams(courseCode);
    const url = `${config.url}?${params}`;
  
    try {
      const response = await fetchWithAuth(url, { method: config.method });
  
      // ===== 情况A：返回 JSON（最理想）=====
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return parseCourseFromJSON(data, courseCode);
      }
  
      // ===== 情况B：返回 HTML 片段（常见）=====
      const html = await response.text();
      return parseCourseFromHTML(html, courseCode);
  
    } catch (error) {
      log(`[查询] 查询课程失败: ${error.message}`, 'error');
      return { isAvailable: false, error: error.message };
    }
  }
  
  /**
   * 解析 JSON 格式的课程数据
   * 根据实际返回的 JSON 结构修改字段名
   */
  function parseCourseFromJSON(data, courseCode) {
    // 根据实际 JSON 结构调整
    // 假设返回格式: { data: [{ courseCode, courseName, selectedCount, maxCount }] }
    const courses = data.data || data.list || data.rows || [];
    const course = courses.find(
      c => String(c.courseCode || c.code || c.id) === String(courseCode)
    );
  
    if (!course) {
      return { isAvailable: false, reason: '课程不存在' };
    }
  
    const selected = parseInt(course.selectedCount || course.selected || 0);
    const max = parseInt(course.maxCount || course.max || course.capacity || 0);
    const isAvailable = selected < max;
  
    return {
      isAvailable,
      courseName: course.courseName || course.name || '',
      quota: max - selected,
      selectedCount: selected,
      maxCount: max,
      raw: course,
    };
  }
  
  /**
   * 解析 HTML 格式的课程数据
   * 用正则提取关键字段，比解析整个 DOM 快得多
   */
  function parseCourseFromHTML(html, courseCode) {
    // 方式1：正则提取（推荐，最快）
    // 根据实际 HTML 结构调整正则
    // 假设 HTML 结构: <tr><td>063130090</td><td>课程名</td><td>45/60</td>...
  
    // 先找到包含目标课程编号的行
    const rowPattern = new RegExp(
      `<tr[^>]*>[\\s\\S]*?${escapeRegExp(courseCode)}[\\s\\S]*?</tr>`,
      'i'
    );
    const rowMatch = html.match(rowPattern);
  
    if (!rowMatch) {
      return { isAvailable: false, reason: '课程不存在' };
    }
  
    const row = rowMatch[0];
  
    // 提取课程名（第2个td）
    const tdMatches = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const tds = tdMatches.map(td => td.replace(/<[^>]+>/g, '').trim());
  
    const courseName = tds[1] || '';
  
    // 提取人数信息（通常在最后一个td或倒数第二个）
    // 假设格式: "45/60" 或 "已选45人/共60人"
    const quotaText = tds.join(' ');
    const quotaMatch = quotaText.match(/(\d+)\s*\/\s*(\d+)/);
    let selected = 0, max = 0, isAvailable = false;
  
    if (quotaMatch) {
      selected = parseInt(quotaMatch[1]);
      max = parseInt(quotaMatch[2]);
      isAvailable = selected < max;
    } else {
      // 如果没有人数信息，检查是否包含"可选"或"未满"等文字
      isAvailable = /可选|未满|有余量/.test(quotaText);
    }
  
    return {
      isAvailable,
      courseName,
      quota: max - selected,
      selectedCount: selected,
      maxCount: max,
      raw: row,
    };
  }
  
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  
  // ============================================================
  // 第五部分：执行选课（替代点击按钮 + 确认弹窗）
  // ============================================================
  
  /**
   * 执行选课操作
   * 返回: { success: boolean, message: string }
   */
  async function executeSelectCourse(courseCode) {
    const config = API_CONFIG.selectCourse;
  
    try {
      const response = await fetchWithAuth(config.url, {
        method: config.method,
        body: config.buildBody(courseCode),
      });
  
      // 解析响应
      const result = await parseResult(response);
  
      if (result.success) {
        log(`[选课] ✅ 选课成功！${courseCode}`, 'success');
      } else {
        log(`[选课] ❌ 选课失败: ${result.message}`, 'error');
      }
  
      return result;
  
    } catch (error) {
      log(`[选课] 请求异常: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }
  
  /**
   * 解析选课/退课操作的响应结果
   * 根据实际返回格式调整判断逻辑
   */
  async function parseResult(response) {
    const contentType = response.headers.get('content-type') || '';
  
    if (contentType.includes('application/json')) {
      const data = await response.json();
      // 根据实际 JSON 结构调整
      // 常见格式: { success: true, msg: "选课成功" }
      // 或: { code: 0, message: "操作成功" }
      // 或: { status: "ok" }
      return {
        success: data.success || data.code === 0 || data.status === 'ok',
        message: data.msg || data.message || data.info || '',
        raw: data,
      };
    }
  
    // 返回 HTML 的情况
    const html = await response.text();
    // 检查是否包含成功/失败的提示文字
    const success = /成功|选课成功|操作成功/i.test(html);
    const message = html.match(/提示[：:]\s*(.+?)(?:<|$)/i)?.[1] || '';
  
    return { success, message };
  }
  
  
  // ============================================================
  // 第六部分：监听模式（核心新增功能）
  // ============================================================
  
  let isListening = false;   // 是否正在监听
  let listenAbort = null;    // 用于停止监听
  let listenStats = {        // 监听统计
    rounds: 0,
    startTime: 0,
  };
  
  /**
   * 启动监听模式
   * 持续轮询课程状态，一旦可选就立即抢课
   */
  async function startListening(courseCode) {
    if (isListening) {
      log('[监听] 已经在监听中', 'warn');
      return;
    }
  
    isListening = true;
    listenStats = { rounds: 0, startTime: Date.now() };
    const controller = new AbortController();
    listenAbort = controller;
  
    log(`[监听] 🔍 开始监听课程 ${courseCode}，每 ${API_CONFIG.pollInterval}ms 查询一次`, 'info');
    updateUIState('listening'); // 更新面板状态
  
    try {
      while (isListening && !controller.signal.aborted) {
        listenStats.rounds++;
  
        // 查询课程状态
        const status = await queryCourseStatus(courseCode);
  
        // 每 10 轮输出一次心跳日志，避免刷屏
        if (listenStats.rounds % 10 === 0) {
          const elapsed = ((Date.now() - listenStats.startTime) / 1000).toFixed(1);
          log(`[监听] 心跳 - 第 ${listenStats.rounds} 轮，已运行 ${elapsed}s`, 'debug');
        }
  
        if (status.isAvailable) {
          log(`[监听] 🎯 检测到课程 ${courseCode} 可选！名额: ${status.quota}`, 'success');
  
          // 立即抢课
          const result = await executeSelectCourse(courseCode);
  
          if (result.success) {
            log(`[监听] 🎉 抢课成功！${courseCode}`, 'success');
            notifyUser('抢课成功', `课程 ${courseCode} 已选上！`);
            updateUIState('success');
            // 可选：播放声音提示
            playNotificationSound();
            return;
          } else {
            log(`[监听] 抢课失败: ${result.message}，继续监听...`, 'warn');
            // 继续监听，不退出（可能只是请求失败，课程还在）
          }
        }
  
        // 等待下一轮
        await sleep(API_CONFIG.pollInterval);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        log('[监听] 监听已停止', 'info');
      } else {
        log(`[监听] 异常: ${error.message}`, 'error');
      }
    } finally {
      stopListening();
    }
  }
  
  /**
   * 停止监听
   */
  function stopListening() {
    isListening = false;
    if (listenAbort) {
      listenAbort.abort();
      listenAbort = null;
    }
    updateUIState('idle');
    const elapsed = ((Date.now() - listenStats.startTime) / 1000).toFixed(1);
    log(`[监听] 已停止，共轮询 ${listenStats.rounds} 轮，耗时 ${elapsed}s`, 'info');
  }
  
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  
  // ============================================================
  // 第七部分：退课模块（在账号A的设备上运行）
  // ============================================================
  
  /**
   * 执行退课操作
   * 在退课端（账号A）运行
   */
  async function executeDropCourse(courseCode) {
    const config = API_CONFIG.dropCourse;
  
    try {
      log(`[退课] 正在退课: ${courseCode}`, 'info');
  
      const response = await fetchWithAuth(config.url, {
        method: config.method,
        body: config.buildBody(courseCode),
      });
  
      const result = await parseResult(response);
  
      if (result.success) {
        log(`[退课] ✅ 退课成功！${courseCode}`, 'success');
  
        // 验证：确认课程真的退掉了
        const verify = await queryCourseStatus(courseCode);
        // 退课后，在已选列表中应该找不到该课程
        // 或者该课程状态变为"可选"
        log(`[退课] 验证结果: ${verify.isAvailable ? '课程已释放' : '验证中...'}`, 'info');
  
        return { success: true, message: '退课成功' };
      } else {
        log(`[退课] ❌ 退课失败: ${result.message}`, 'error');
        return { success: false, message: result.message };
      }
  
    } catch (error) {
      log(`[退课] 请求异常: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }
  
  
  // ============================================================
  // 第八部分：辅助功能
  // ============================================================
  
  /**
   * 日志输出（和你现有的日志系统对接）
   */
  function log(msg, level = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const colors = {
      info: 'color: #4FC3F7',
      success: 'color: #66BB6A',
      error: 'color: #EF5350',
      warn: 'color: #FFA726',
      debug: 'color: #90A4AE',
    };
    console.log(`%c[抢课脚本 ${timestamp}] ${msg}`, colors[level] || '');
  
    // 同时输出到你的控制面板日志区域
    // appendPanelLog(`[${timestamp}] ${msg}`);  // ← 对接你的 UI 日志
  }
  
  /**
   * 更新控制面板 UI 状态
   */
  function updateUIState(state) {
    // 对接你现有的 UI
    switch (state) {
      case 'listening':
        // 按钮变黄/闪烁，显示"监听中..."
        // document.getElementById('btn-listen').style.background = '#FFA726';
        // document.getElementById('btn-listen').textContent = '监听中...';
        break;
      case 'success':
        // 按钮变绿，显示"选课成功"
        break;
      case 'idle':
        // 恢复默认状态
        break;
    }
  }
  
  /**
   * 通知用户
   */
  function notifyUser(title, body) {
    // 浏览器通知
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  
    // 弹窗提示（兜底）
    // alert(`${title}: ${body}`);
  }
  
  /**
   * 播放提示音
   */
  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      oscillator.start();
      setTimeout(() => { oscillator.stop(); ctx.close(); }, 500);
    } catch (e) {
      // 静默失败
    }
  }
  
  
  // ============================================================
  // 第九部分：UI 改造 —— 控制面板新增组件
  // ============================================================
  
  /*
   * 在你的控制面板中新增以下 UI 元素：
   *
   * ┌─────────────────────────────────────┐
   * │  监听模式                            │
   * │  ┌─────────────────────────────┐    │
   * │  │ 课程编号: [_______________]  │    │
   * │  └─────────────────────────────┘    │
   * │  ┌──────────┐  ┌──────────┐        │
   * │  │ 开始监听  │  │ 停止监听  │        │
   * │  └──────────┘  └──────────┘        │
   * │  状态: 监听中... 已轮询 120 轮       │
   * └─────────────────────────────────────┘
   *
   * 按钮事件绑定：
   *   开始监听 → startListening(courseCode)
   *   停止监听 → stopListening()
   */
  
  /**
   * 初始化监听模式 UI（示例）
   */
  function initListenModeUI() {
    // 在你的面板中创建监听模式的 HTML 元素
    // 这部分需要根据你现有的 UI 框架来具体实现
  
    // 示例：动态添加按钮
    const panel = document.querySelector('#your-panel-root'); // ← 改成你的面板选择器
  
    // 创建监听区域
    const listenSection = document.createElement('div');
    listenSection.innerHTML = `
      <div class="listen-section">
        <h3>监听模式（退课换号）</h3>
        <input id="listen-course-code" type="text" placeholder="输入课程编号" />
        <button id="btn-start-listen" class="btn btn-primary">开始监听</button>
        <button id="btn-stop-listen" class="btn btn-danger">停止监听</button>
        <div id="listen-status">状态: 空闲</div>
      </div>
    `;
    panel.appendChild(listenSection);
  
    // 绑定事件
    document.getElementById('btn-start-listen').addEventListener('click', () => {
      const code = document.getElementById('listen-course-code').value.trim();
      if (!code) {
        alert('请输入课程编号');
        return;
      }
      startListening(code);
    });
  
    document.getElementById('btn-stop-listen').addEventListener('click', () => {
      stopListening();
    });
  }
  
  
  // ============================================================
  // 第十部分：操作流程
  // ============================================================
  
  /*
   * 完整操作流程：
   *
   * 准备工作：
   *   1. 设备A（退课端）：打开教务系统，登录账号A
   *      运行退课脚本，输入课程编号
   *   2. 设备B（抢课端）：打开教务系统，登录账号B
   *      运行抢课脚本，输入课程编号
   *
   * 执行：
   *   1. 约定时间到达前 30 秒
   *      → 设备B：点击"开始监听"
   *   2. 约定时间到达
   *      → 设备A：点击"退课"（或定时自动执行）
   *   3. 设备B自动检测到课程可选
   *      → 自动执行选课
   *   4. 完成
   *      → 设备B：显示结果，播放提示音
   *
   * 注意事项：
   *   - 如果教务系统支持，退课端也可以定时自动退课
   *   - 建议在凌晨等低竞争时段操作
   *   - 如果可能，退课和抢课两端的操作人互相配合，通信确认
   */
  
  
  // ============================================================
  // 附：网络请求抓取检查清单
  // ============================================================
  
  /*
   * 打开 F12 → Network 标签页，手动操作后，确认你记录了以下信息：
   *
   * □ 查询课程接口
   *   - URL: ______________________________
   *   - 方法: GET / POST
   *   - 参数: ______________________________
   *   - 返回格式: JSON / HTML
   *
   * □ 选课接口
   *   - URL: ______________________________
   *   - 方法: POST
   *   - 请求体参数: ______________________________
   *   - 特殊请求头: ______________________________
   *   - 成功响应标志: ______________________________
   *
   * □ 退课接口
   *   - URL: ______________________________
   *   - 方法: POST
   *   - 请求体参数: ______________________________
   *   - 特殊请求头: ______________________________
   *
   * □ CSRF Token（如果有）
   *   - 位置: meta / input / script
   *   - 请求头字段名: ______________________________
   *
   * □ 其他注意事项
   *   - 是否有 Referer 校验: 是 / 否
   *   - 是否有时间戳校验: 是 / 否
   *   - 选课是否需要班级ID: 是 / 否
   */


// ============================================================
// 附录：东北电力大学（强智教务）实测配置 —— 2026-07-09 抓包
// 系统地址: https://jwxt.neepu.edu.cn/jsxsd/
// ============================================================

const NEEpu_API = {
  baseUrl: 'https://jwxt.neepu.edu.cn',
  referer: 'https://jwxt.neepu.edu.cn/jsxsd/xsxkkc/comeInGgxxkxk',

  queryCourse: {
    url: '/jsxsd/xsxkkc/xsxkGgxxkxk',
    queryString:
      'kcxx=&skls=&skxq=&endJc=&skjc=&sfym=true&sfct=true&szjylb=&sfxx=true&skfs=',
    columns: [
      'kch', 'kcmc', 'xf', 'skls', 'sksj', 'skdd',
      'xqmc', 'xkrs', 'syrs', 'ctsm', 'tsTskflMc', 'czOper',
    ],
  },

  selectCourse: {
    url: '/jsxsd/xsxkkc/ggxxkxkOper',
  },

  pollInterval: 150,
};

/** 构建 DataTables 查询 POST Body */
function neepuBuildQueryBody(courseCode = '') {
  const p = new URLSearchParams();
  p.append('kcxx', courseCode);
  p.append('skls', '');
  p.append('skxq', '');
  p.append('endJc', '');
  p.append('skjc', '');
  p.append('sfym', 'true');
  p.append('sfct', 'true');
  p.append('szjylb', '');
  p.append('sfxx', 'true');
  p.append('skfs', '');
  p.append('sEcho', '1');
  p.append('iColumns', '12');
  p.append('sColumns', '');
  p.append('iDisplayStart', '0');
  p.append('iDisplayLength', '50');
  NEEpu_API.queryCourse.columns.forEach((col, i) => {
    p.append(`mDataProp_${i}`, col);
  });
  return p;
}

/** 通用 fetch（Cookie 自动携带） */
async function neepuFetch(url, options = {}) {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    Accept: '*/*',
    ...options.headers,
  };
  if (options.body instanceof URLSearchParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
    referrer: NEEpu_API.referer,
  });
  return res;
}

/** 查询课程列表，返回 DataTables JSON */
async function neepuQueryCourseList(courseCode = '') {
  const { baseUrl, queryCourse } = NEEpu_API;
  const url = `${baseUrl}${queryCourse.url}?${queryCourse.queryString}`;
  const res = await neepuFetch(url, {
    method: 'POST',
    body: neepuBuildQueryBody(courseCode),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('查询返回非 JSON，请检查登录状态: ' + text.slice(0, 100));
  }
}

/** 从 aaData 解析课程，提取 kcid / jx0404id / syrs（剩余名额） */
function neepuParseCourses(data, courseCode) {
  const rows = data.aaData || [];
  if (!rows.length) {
    return { isAvailable: false, reason: '无匹配课程', courses: [] };
  }

  const courses = rows.map((row) => {
    const czOper = row.czOper || row[11] || '';
    const linkMatch = czOper.match(
      /ggxxkxkOper\?kcid=([^&"']+)[^"']*jx0404id=([^&"']+)/i,
    );
    const onclickMatch = czOper.match(
      /ggxxkxkOper\s*\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'([^']+)'/i,
    );
    const ids = linkMatch || onclickMatch;
    const syrs = parseInt(row.syrs ?? row[8] ?? '0', 10);

    return {
      kch: row.kch ?? row[0] ?? '',
      kcmc: row.kcmc ?? row[1] ?? '',
      xkrs: row.xkrs ?? row[7] ?? '',
      syrs,
      isAvailable: syrs > 0 && !/已满|不可选/i.test(czOper),
      kcid: ids?.[1] || null,
      jx0404id: ids?.[2] || null,
      czOper,
    };
  });

  let target =
    courses.find((c) => c.kch === courseCode) ||
    courses.find(
      (c) =>
        c.kch.includes(courseCode) ||
        (c.kcmc && c.kcmc.includes(courseCode)),
    ) ||
    courses[0];

  return {
    isAvailable: target.isAvailable && !!target.kcid && !!target.jx0404id,
    ...target,
    courses,
  };
}

/**
 * 解析选课响应
 * 实测成功: {"success":true,"message":"当前已选择学分1.0剩1.0学分可以选择","jfViewStr":""}
 * 失败时 success 为 false，message 含原因
 */
function neepuParseSelectResult(data) {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return {
        success: /成功/i.test(data),
        message: data.slice(0, 120),
      };
    }
  }
  return {
    success: data.success === true,
    message: data.message || data.msg || '',
    raw: data,
  };
}

/** 执行选课 GET */
async function neepuSelectCourse(kcid, jx0404id) {
  const qs = new URLSearchParams({
    kcid,
    cfbs: 'null',
    jx0404id,
    xkzy: '',
    trjf: '',
  });
  const url = `${NEEpu_API.baseUrl}${NEEpu_API.selectCourse.url}?${qs}`;
  const res = await neepuFetch(url, { method: 'GET' });
  const text = await res.text();
  try {
    return neepuParseSelectResult(JSON.parse(text));
  } catch {
    return neepuParseSelectResult(text);
  }
}

/** 监听模式：轮询查询，有余量立即选课 */
let neepuListening = false;

async function neepuStartListening(courseCode) {
  if (neepuListening) return;
  neepuListening = true;
  let round = 0;
  console.log(`[东北电力] 开始监听 ${courseCode}，间隔 ${NEEpu_API.pollInterval}ms`);

  while (neepuListening) {
    round++;
    try {
      const raw = await neepuQueryCourseList(courseCode);
      const status = neepuParseCourses(raw, courseCode);

      if (round % 10 === 0) {
        console.log(
          `[${round}] ${status.kcmc || courseCode} 剩余:${status.syrs ?? '?'}`,
        );
      }

      if (status.isAvailable) {
        console.log(`🎯 检测到可选! kcid=${status.kcid}`);
        const result = await neepuSelectCourse(status.kcid, status.jx0404id);
        console.log(result.success ? '✅' : '❌', result.message);
        if (result.success) {
          neepuListening = false;
          return result;
        }
      }
    } catch (e) {
      console.error('[东北电力] 异常:', e.message);
    }
    await new Promise((r) => setTimeout(r, NEEpu_API.pollInterval));
  }
}

function neepuStopListening() {
  neepuListening = false;
}

// 控制台用法:
//   neepuStartListening('063130090')   // 开始监听并抢课
//   neepuStopListening()               // 停止
//
// 单次测试:
//   neepuQueryCourseList('063130090').then(d => console.log(neepuParseCourses(d, '063130090')))
//   neepuSelectCourse('kcid值', 'jx0404id值').then(console.log)
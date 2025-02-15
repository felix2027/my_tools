const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/felix2027/my_tools/main/workers/chatBot/fraud.db';
const notificationUrl = ''

const chatSessions = {};  // 存储所有聊天会话的状态

const enable_notification = true

let currentChatTarget = null;  // 当前聊天目标ID
const localFraudList = []; // 本地存储骗子ID的数组
let chatTargetUpdated = false; // 标志是否更新了聊天目标

const blockedUsers = []; // 本地存储被屏蔽用户的数组
let pendingMessage = null; // 全局变量保存待发送的消息


// 在程序启动时加载会话状态
loadChatSession();
// 在程序启动时加载被屏蔽用户列表
loadBlockedUsers();
// 在程序启动时加载骗子列表
loadFraudList();

function escapeMarkdown(text) {
  return text.replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}


/**
 * Return url to telegram api, optionally with parameters added
 */

function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body)
    .then(r => {
      if (!r.ok) { // 检查HTTP状态码
        console.error(`Telegram API request failed for method ${methodName}, status: ${r.status}`);
        throw new Error(`Telegram API request failed with status ${r.status}`); // 抛出错误以便上层处理
      }
      return r.json();
    })
    .then(r => {
      if (!r.ok) { // 检查Telegram API的 "ok" 字段
        console.error(`Telegram API response error for method ${methodName}:`, r);
        throw new Error(`Telegram API response error: ${r.description || 'Unknown error'}`);
      }
      return r;
    });
}


function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}

function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

function generateKeyboard(options) {
  return {
    reply_markup: {
      inline_keyboard: options.map(option => [{
        text: option.text,
        callback_data: option.callback_data
      }])
    }
  };
}

async function saveChatSession() {
  await FRAUD_LIST.put('chatSessions', JSON.stringify(chatSessions));
}

async function loadChatSession() {
  const storedSessions = await FRAUD_LIST.get('chatSessions');
  if (storedSessions) {
    Object.assign(chatSessions, JSON.parse(storedSessions));
  }
}

async function generateRecentChatButtons() {
  const recentChatTargets = await getRecentChatTargets();
  const buttons = await Promise.all(recentChatTargets.map(async chatId => {
    const userInfo = await getUserInfo(chatId);
    console.log(`UserInfo for chatId ${chatId}:`, userInfo); // 调试信息 - 保留， 方便查看 userInfo 内容

    let nickname = getUserNickname(userInfo, chatId);

    return {
      text: `发给： ${nickname}`,
      callback_data: `select_${chatId}`
    };
  }));
  return generateKeyboard(buttons);
}

async function saveBlockedUsers() {
  await FRAUD_LIST.put('blockedUsers', JSON.stringify(blockedUsers));
}

async function searchUserByUID(uid) {
  const userInfo = await getUserInfo(uid);
  if (userInfo) {
    return userInfo; //  改对了！ 直接返回 userInfo 对象 (也就是 response.result)
  } else {
    return null; //  userInfo 获取失败时，还是返回 null
  }
}

async function loadBlockedUsers() {
  blockedUsers.length = 0; // 加载前清空数组，避免重复添加
  const storedList = await FRAUD_LIST.get('blockedUsers');
  if (storedList) {
    blockedUsers.push(...JSON.parse(storedList));
  }
}

// 最近聊天目标函数
async function saveRecentChatTargets(chatId) {
  let recentChatTargets = await FRAUD_LIST.get('recentChatTargets', { type: "json" }) || [];
  // 如果聊天目标已经存在，则移到最前面
  recentChatTargets = recentChatTargets.filter(id => id !== chatId.toString());
  recentChatTargets.unshift(chatId.toString());
  // 保持最多五个聊天目标
  if (recentChatTargets.length > 5) {
    recentChatTargets.pop();
  }
  await FRAUD_LIST.put('recentChatTargets', JSON.stringify(recentChatTargets));
}

async function getRecentChatTargets() {
  let recentChatTargets = await FRAUD_LIST.get('recentChatTargets', { type: "json" }) || [];
  return recentChatTargets.map(id => id.toString());
}


// 保存骗子id到kv空间
async function saveFraudList() {
  await FRAUD_LIST.put('localFraudList', JSON.stringify(localFraudList));
}

async function loadFraudList() {
  localFraudList.length = 0; // 加载前清空数组，避免重复添加
  const storedList = await FRAUD_LIST.get('localFraudList');
  if (storedList) {
    localFraudList.push(...JSON.parse(storedList));
  }
}

async function setBotCommands() {
  const commands = [
    { command: 'start', description: '启动机器人会话' },
    { command: 'help', description: '显示帮助信息' },
    { command: 'search', description: '查看指定uid用户最新昵称' },
    { command: 'block', description: '屏蔽用户 (仅管理员)' },
    { command: 'unblock', description: '解除屏蔽用户 (仅管理员)' },
    { command: 'checkblock', description: '检查用户是否被屏蔽 (仅管理员)' },
    { command: 'fraud', description: '添加骗子ID - [本地库] (仅管理员)' },
    { command: 'unfraud', description: '移除骗子ID - [本地库] (仅管理员)' },
    { command: 'list', description: '查看骗子ID列表 - [本地库] (仅管理员)' },
    { command: 'blocklist', description: '查看屏蔽用户列表 - [本地库] (仅管理员)' }

    // 在此添加更多命令
  ];
  const r = await requestTelegram('setMyCommands', makeReqBody({ commands }));
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else if (url.pathname === '/setCommands') {
    event.respondWith(setBotCommands())
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})


async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  const update = await event.request.json()
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

async function onUpdate(update) {
  if (update.message) {
    await onMessage(update.message);
  } else if (update.callback_query) {
    await onCallbackQuery(update.callback_query);
  }
}

async function getUserInfo(chatId) {
  try {
    const response = await requestTelegram('getChat', makeReqBody({ chat_id: chatId }));
    console.log(`Response for getUserInfo with chatId ${chatId}:`, response); // 调试信息
    return response.result;
  } catch (error) {
    console.error(`Failed to get user info for chat ID ${chatId}:`, error);
    return null;
  }
}


async function getChatMember(chatId) {
  try {
    const response = await requestTelegram('getChatMember', makeReqBody({ chat_id: chatId, user_id: chatId }));
    console.log(`Response for getChatMember with chatId ${chatId}:`, response); // 调试信息
    return response.result;
  } catch (error) {
    console.error(`Failed to get chat member info for chat ID ${chatId}:`, error);
    return null;
  }
}

async function getUserProfilePhotos(userId) {
  try {
    const response = await requestTelegram('getUserProfilePhotos', makeReqBody({ user_id: userId }));
    console.log(`Response for getUserProfilePhotos with userId ${userId}:`, response); // 调试信息
    if (response.ok) {
      const photos = response.result.photos;
      if (photos.length > 0) {
        return `用户存在，头像数量: ${photos.length}`;
      } else {
        return '用户存在，但没有头像';
      }
    } else {
      console.error(`Failed to get user profile photos for user ID ${userId}:`, response);
      return null;
    }
  } catch (error) {
    console.error(`Error in getUserProfilePhotos for user ID ${userId}:`, error);
    return null;
  }
}

async function getChat(chatId) {
  try {
    const response = await requestTelegram('getChat', makeReqBody({ chat_id: chatId }));
    console.log(`Response for getChat with chatId ${chatId}:`, response); // 调试信息
    return response.result;
  } catch (error) {
    console.error(`Failed to get chat info for chat ID ${chatId}:`, error);
    return null;
  }
}


/**
 * 工具函数：生成用户昵称，优先使用用户名，其次使用 "FirstName LastName"，最后使用 "UID:chatId"
 * @param {object} userInfo 用户信息对象 (Telegram API getChat/getUser 返回的结果)
 * @param {string} chatId  用户 Chat ID (可选，用于在 userInfo 缺失时作为 fallback)
 * @returns {string} 用户昵称
 */
function getUserNickname(userInfo, chatId) {
  if (!userInfo) { //  如果 userInfo 为 null，表示 getUserInfo 获取用户信息失败
    return `UID:${chatId || '未知UID'} (无法获取昵称)`; // 返回 UID + 无法获取昵称的提示
  }
  if (userInfo?.username) {
    return `@${userInfo.username}`;
  } else if (userInfo?.first_name) {
    return `${userInfo.first_name} ${userInfo.last_name || ''}`.trim();
  } else {
    return `UID:${chatId || '未知UID'}`;
  }
}

/**
 *  消息处理主函数，根据消息类型和内容分发到不同的处理函数
 * @param {object} message  Telegram message object
 */
async function onMessage(message) {
  const chatId = message.chat.id.toString();

  // 初始化会话状态
  if (!chatSessions[chatId]) {
    chatSessions[chatId] = {
      step: 0,
      lastInteraction: Date.now()
    };
  }
  const session = chatSessions[chatId];
  session.lastInteraction = Date.now(); // 更新最后交互时间

  currentChatTarget = await getCurrentChatTarget(); // 获取当前聊天目标

  if (message.reply_to_message) {
    await handleReplyMessage(message); // 处理回复消息
  } else if (message.text) {
    await handleTextMessage(message);   // 处理文本消息
  } else if (message.photo || message.video || message.document || message.audio) {
    await handleMediaMessage(message); // 处理媒体消息
  }

  // 管理员消息处理 (判断是否为管理员消息需要在各种消息类型处理之后，避免普通用户冒充管理员)
  if (message.chat.id.toString() === ADMIN_UID) {
    await handleAdminMessage(message); // 处理管理员消息
    return; // 管理员消息处理完后直接返回，不再进行普通用户消息处理
  }

  return handleGuestMessage(message); // 处理普通用户消息
}


/**
 * 处理回复消息
 * @param {object} message Telegram message object
 */
async function handleReplyMessage(message) {
  const repliedChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (repliedChatId) {
    currentChatTarget = repliedChatId;
    await setCurrentChatTarget(repliedChatId); // 更新当前聊天目标并发送通知
  }
}

/**
 * 处理文本消息，根据命令或文本内容分发到不同的处理函数
 * @param {object} message Telegram message object
 */
async function handleTextMessage(message) {
  const text = message.text;

  if (text === '/start') {
    await handleStartCommand(message);
  } else if (text === '/help') {
    await handleHelpCommand(message);
  } else if (text === '/blocklist') {
    await handleBlocklistCommand(message);
  } else if (text.startsWith('/unblock ')) {
    await handleUnblockCommandByNumber(message);
  } else if (text === '/list') {
    await handleListFraudCommand(message);
  } else if (text.startsWith('/search')) {
    await handleSearchCommand(message);
  } else if (text.startsWith('/fraud')) {
    await handleFraudCommand(message);
  } else if (text.startsWith('/unfraud')) {
    await handleUnfraudCommand(message);
  } else if (text === '/block') {
    await handleBlockCommand(message);
  } else if (text === '/unblock') {
    await handleUnblockCommand(message);
  } else if (text === '/checkblock') {
    await handleCheckBlockCommand(message);
  }
}

/**
 *  处理媒体消息 (目前仅支持管理员发送媒体消息给用户)
 * @param {object} message Telegram message object
 */
async function handleMediaMessage(message) {
  console.log("收到媒体消息，等待管理员处理:", message.message_id);
  await sendMessage({
    chat_id: message.chat.id,
    text: "已收到媒体消息，请等待管理员进一步处理。"
  });
}


/**
 * 处理 '/start' 命令
 * @param {object} message Telegram message object
 */
async function handleStartCommand(message) {
  let startMsg = "Welcome to Felix's chatbot";
  await setBotCommands();
  return sendMessage({
    chat_id: message.chat.id,
    text: startMsg,
  });
}

/**
 * 处理 '/help' 命令
 * @param {object} message Telegram message object
 */
async function handleHelpCommand(message) {
  let helpMsg = "可用指令列表:\n" +
    "/start - 启动机器人会话\n" +
    "/help - 显示此帮助信息\n" +
    "/search - 通过uid查询最新名字\n" + //查看指定uid最新用户名
    "/block - 屏蔽用户 (仅管理员)\n" +
    "/unblock - 解除屏蔽用户 (仅管理员)\n" +
    "/checkblock - 检查用户是否被屏蔽 (仅管理员)\n" +
    "/fraud - 添加骗子ID (仅管理员)\n" + // 更新帮助信息
    "/unfraud - 移除骗子ID (仅管理员)\n" + // 更新帮助信息
    "/list - 查看本地骗子ID列表 (仅管理员)\n" + // 添加新命令
    "/blocklist - 查看被屏蔽用户列表 (仅管理员)\n" + // 添加新命令
    "更多指令将在后续更新中添加。";
  return sendMessage({
    chat_id: message.chat.id,
    text: helpMsg,
  });
}

/**
 *  处理 '/blocklist' 命令 -  列出被屏蔽用户 (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleBlocklistCommand(message) {
  return listBlockedUsers();
}

/**
 * 处理 '/unblock <序号>' 命令 - 根据序号解除屏蔽用户 (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleUnblockCommandByNumber(message) {
  const index = parseInt(message.text.split(' ')[1], 10);
  if (!isNaN(index)) {
    return unblockByIndex(index);
  } else {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无效的序号。'
    });
  }
}

/**
 *  处理 '/list' 命令 - 列出本地骗子ID列表 (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleListFraudCommand(message) {
    // 处理 /list 命令
    const storedList = await FRAUD_LIST.get('localFraudList');
    if (storedList) {
      localFraudList.length = 0; // 清空当前列表，确保只包含最新数据
      localFraudList.push(...JSON.parse(storedList));
    }
  
    if (localFraudList.length === 0) {
      return sendMessage({
        chat_id: message.chat.id,
        text: '本地没有骗子ID。'
      });
    } else {
      const fraudListText = await Promise.all(localFraudList.map(async uid => {
        const userInfo = await searchUserByUID(uid); // 现在 searchUserByUID 返回 userInfo 对象或 null
        let nickname = '无法获取昵称'; // 默认昵称为 "无法获取昵称"
        if (userInfo) { //  如果成功获取到 userInfo
          nickname = getUserNickname(userInfo, uid); //  使用 getUserNickname 函数从 userInfo 中生成昵称
        }
        return `UID: ${uid}, 昵称: ${nickname}`;
      }));
      return sendMessage({
        chat_id: message.chat.id,
        text: `本地骗子ID列表:\n${fraudListText.join('\n')}`
      });
    }
  }

/**
 * 处理 '/search <用户UID>' 命令 -  搜索用户信息 (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleSearchCommand(message) {
  const parts = message.text.split(' ');
  if (parts.length === 2) {
    const searchId = parts[1].toString(); // 确保 UID 是字符串类型
    const userInfo = await searchUserByUID(searchId);

    console.log("handleSearchCommand 函数中，searchUserByUID 返回的 userInfo:", userInfo); //  关键日志： 打印 userInfo 对象

    if (userInfo) {
      //  直接从 userInfo 对象中提取需要的字段并格式化
      const responseText = `用户信息:\n` +
                               `UID: ${userInfo.id}\n` +
                               `FirstName: ${userInfo.first_name || 'N/A'}\n` + //  如果 first_name 不存在，显示 "N/A"
                               `LastName: ${userInfo.last_name || 'N/A'}\n`  + // 如果 last_name 不存在，显示 "N/A"
                               `Type: ${userInfo.type}\n` +
                               `CanSendGift: ${userInfo.can_send_gift}\n` +
                               `HasPrivateForwards: ${userInfo.has_private_forwards}`;

      console.log("handleSearchCommand 函数中，responseText:", responseText); // 关键日志： 打印 responseText

      return sendMessage({
        chat_id: message.chat.id,
        text: responseText
      });
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: `无法找到 UID: ${searchId} 的用户信息。请检查 UID 是否正确或用户隐私设置。` // 更友好的错误提示
      });
    }
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: /search <用户UID>'
    });
  }
}

/**
 *  处理 '/fraud <用户UID>' 命令 - 添加骗子ID (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleFraudCommand(message) {
  const parts = message.text.split(' ');
  if (parts.length === 2) {
    const fraudId = parts[1].toString(); // 确保 UID 是字符串类型
    if (!localFraudList.includes(fraudId)) { // 检查是否已经存在
      localFraudList.push(fraudId); // 添加到本地数组
      await saveFraudList(); // 保存更新后的列表
      return sendMessage({
        chat_id: message.chat.id,
        text: `已添加骗子ID: ${fraudId}`
      });
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: `骗子ID: ${fraudId} 已存在`
      });
    }
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: /fraud <用户UID>'
    });
  }
}

/**
 *  处理 '/unfraud <用户UID>' 命令 -  移除骗子ID (仅管理员)
 * @param {object} message Telegram message object
 */
async function handleUnfraudCommand(message) {
  const parts = message.text.split(' ');
  if (parts.length === 2) {
    const fraudId = parts[1].toString(); // 确保 UID 是字符串类型
    const index = localFraudList.indexOf(fraudId);
    if (index > -1) {
      localFraudList.splice(index, 1); // 从本地数组中移除
      await saveFraudList(); // 保存更新后的列表
      return sendMessage({
        chat_id: message.chat.id,
        text: `已移除骗子ID: ${fraudId}`
      });
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: `骗子ID: ${fraudId} 不在本地列表中`
      });
    }
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: /unfraud <用户UID>'
    });
  }
}

/**
 *  处理 '/block' 命令 - 屏蔽用户 (仅管理员，需要回复消息)
 * @param {object} message Telegram message object
 */
async function handleBlockCommand(message) {
  if (message.reply_to_message) {
    return handleBlock(message); // 调用原有的屏蔽处理函数
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: 请回复某条消息并输入 /block 来屏蔽用户。'
    });
  }
}

/**
 * 处理 '/unblock' 命令 - 解除屏蔽用户 (仅管理员，需要回复消息或序号)
 * @param {object} message Telegram message object
 */
async function handleUnblockCommand(message) {
  if (message.reply_to_message) {
    return handleUnBlock(message); // 回复消息解除屏蔽
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: 请【 回复某条消息并输入 /unblock 】 或 【使用 /unblock 屏蔽序号 】来解除屏蔽用户。\n 屏蔽序号可以通过 /blocklist 获取'
    });
  }
}

/**
 * 处理 '/checkblock' 命令 - 检查用户是否被屏蔽 (仅管理员，需要回复消息)
 * @param {object} message Telegram message object
 */
async function handleCheckBlockCommand(message) {
  if (message.reply_to_message) {
    return checkBlock(message); // 调用原有的检查屏蔽状态函数
  } else {
    return sendMessage({
      chat_id: message.chat.id,
      text: '使用方法: 请回复某条消息并输入 /checkblock 来检查用户是否被屏蔽。'
    });
  }
}


/**
 * 处理管理员消息 (根据是否有回复消息，分发到不同的处理函数)
 * @param {object} message Telegram message object
 */
async function handleAdminMessage(message) {
  if (message.reply_to_message) {
    await handleAdminReplyMessage(message); // 处理管理员回复消息
  } else {
    await handleAdminDirectMessage(message); // 处理管理员直接发送的消息
  }
}


/**
 * 处理管理员回复消息 (转发消息给目标用户)
 * @param {object} message Telegram message object
 */
async function handleAdminReplyMessage(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (guestChatId) {
    currentChatTarget = guestChatId;  // 更新当前聊天目标
    await setCurrentChatTarget(guestChatId); // 更新当前聊天目标并发送通知
    if (message.text) {
      // 发送管理员输入的文本消息内容
      await sendMessage({
        chat_id: guestChatId,
        text: message.text,
      });
    } else if (message.photo || message.video || message.document || message.audio) {
      console.log("Copying media message:", message.message_id); // 日志输出
      // 如果消息包含媒体文件，使用 copyMessage 方法复制媒体文件
      await copyMessage({
        chat_id: guestChatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      });
    }
  }
}

/**
 * 处理管理员直接发送的消息 (发送消息给当前聊天目标)
 * @param {object} message Telegram message object
 */
async function handleAdminDirectMessage(message) {
  if (!currentChatTarget) {
    // 保存消息内容
    pendingMessage = message;
    const recentChatButtons = await generateRecentChatButtons();
    return sendMessage({
      chat_id: ADMIN_UID,
      text: "没有设置当前聊天目标!\n请先通过【回复某条消息】或【点击下方按钮】来设置聊天目标。",
      reply_markup: recentChatButtons.reply_markup
    });
  }
  if (message.text) {
    // 直接发送文本消息到当前聊天目标
    await sendMessage({
      chat_id: currentChatTarget,
      text: message.text,
    });
  } else if (message.photo || message.video || message.document || message.audio) {
    console.log("Copying media message:", message.message_id); // 日志输出
    // 如果消息包含媒体文件，使用 copyMessage 方法复制媒体文件
    await copyMessage({
      chat_id: currentChatTarget,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  }
}


/**
 * 发送直接消息给当前聊天目标 (如果已设置)
 * @param {string} text 消息文本
 * @returns {Promise<Response>}
 */
async function sendDirectMessage(text) {
  if (currentChatTarget) {
    return sendMessage({
      chat_id: currentChatTarget,
      text: text
    });
  } else {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: "没有设置当前聊天目标，请先通过回复某条消息来设置聊天目标。"
    });
  }
}


/**
 * 处理普通用户消息 (转发消息给管理员)
 * @param {object} message Telegram message object
 */
async function handleGuestMessage(message) {
  let chatId = message.chat.id.toString();
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" });

  if (isblocked) {
    return sendMessage({
      chat_id: chatId,
      text: '您已被屏蔽'
    });
  }

  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  });

  if (forwardReq.ok) {
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId);
    // 发送新的聊天目标通知 (简化通知逻辑，每次都发送)
    await sendChatTargetNotification(chatId);
    // 将新的聊天目标添加到最近聊天的数组中
    await saveRecentChatTargets(chatId);
  }
  return handleNotify(message);
}


/**
 * 发送图片消息
 * @param {object} msg 消息参数
 * @returns {Promise<Response>}
 */
async function sendPhoto(msg) {
  return requestTelegram('sendPhoto', makeReqBody(msg));
}

/**
 * 发送视频消息
 * @param {object} msg 消息参数
 * @returns {Promise<Response>}
 */
async function sendVideo(msg) {
  return requestTelegram('sendVideo', makeReqBody(msg));
}

/**
 * 发送文档消息
 * @param {object} msg 消息参数
 * @returns {Promise<Response>}
 */
async function sendDocument(msg) {
  return requestTelegram('sendDocument', makeReqBody(msg));
}

/**
 * 发送音频消息
 * @param {object} msg 消息参数
 * @returns {Promise<Response>}
 */
async function sendAudio(msg) {
  return requestTelegram('sendAudio', makeReqBody(msg));
}


/**
 * 处理 Inline Keyboard 回调查询
 * @param {object} callbackQuery Telegram callbackQuery object
 */
async function onCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;

  if (data.startsWith('select_')) {
    const selectedChatId = data.split('_')[1];
    if (currentChatTarget !== selectedChatId) {
      currentChatTarget = selectedChatId;
      await setCurrentChatTarget(selectedChatId); // 更新当前聊天目标并发送通知
      // 新增：更新会话状态 (可选，如果需要记录管理员会话目标)
      chatSessions[ADMIN_UID] = {
        target: selectedChatId,
        timestamp: Date.now()
      };
      await saveChatSession();

      // 发送之前保存的消息 (如果有)
      if (pendingMessage) {
        try {
          if (pendingMessage.text) {
            await sendMessage({
              chat_id: currentChatTarget,
              text: pendingMessage.text,
            });
          } else if (pendingMessage.photo) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.video) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.document) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.audio) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          }
          await sendMessage({
            chat_id: ADMIN_UID,
            text: "消息已成功转发给目标用户。",
            reply_to_message_id: pendingMessage.message_id // 引用上一条消息
          });
        } catch (error) {
          await sendMessage({
            chat_id: ADMIN_UID,
            text: "消息转发失败，请重试。",
            reply_to_message_id: pendingMessage.message_id // 引用上一条消息
          });
        } finally {
          pendingMessage = null; // 清空待发送消息
        }
      }
    }
  }
}


/**
 *  获取当前聊天目标 (从 KV 存储中读取)
 *  如果存在且未过期 (30分钟)，则返回目标ID，否则返回 null
 * @returns {string|null} 当前聊天目标ID
 */
async function getCurrentChatTarget() {
  const session = await FRAUD_LIST.get('currentChatTarget', { type: 'json' });
  if (session) {
    const elapsed = Date.now() - session.timestamp;
    if (elapsed < 30 * 60 * 1000) { // 30分钟有效期
      return session.target;
    } else {
      await FRAUD_LIST.delete('currentChatTarget'); // 删除过期的聊天目标
    }
  }
  return null;
}


/**
 *  设置当前聊天目标 (并更新 KV 存储)
 *  同时发送切换聊天目标的通知给管理员
 * @param {string} target 聊天目标ID
 */
async function setCurrentChatTarget(target) {
  const session = {
    target: target,
    timestamp: Date.now()
  };
  await FRAUD_LIST.put('currentChatTarget', JSON.stringify(session));

  // 发送切换聊天目标的通知
  await sendChatTargetNotification(target);
}


/**
 * 发送聊天目标切换通知给管理员
 * @param {string} chatId 聊天目标ID
 */
async function sendChatTargetNotification(chatId) {
  const userInfo = await getUserInfo(chatId);
  let nickname = getUserNickname(userInfo, chatId);
  nickname = escapeMarkdown(nickname);
  const chatLink = `tg://user?id=${chatId}`;
  let messageText = `已切换到聊天目标:【 *${nickname}* 】 \nuid：${chatId}\n[点击不用bot直接私聊](${chatLink})`;
  if (await isFraud(chatId)) {
    messageText += `\n\n*请注意，对方是骗子!*`; // 添加警告信息
  }
  // 发送切换聊天目标的通知
  await sendMessage({
    chat_id: ADMIN_UID,
    parse_mode: 'MarkdownV2', // 使用Markdown格式
    text: messageText
  });
}


/**
 *  处理消息通知 (例如，发送交易提醒)
 *  如果用户是骗子，发送警告信息，否则根据时间间隔发送普通通知
 * @param {object} message Telegram message object
 */
async function handleNotify(message) {
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      parse_mode: 'Markdown', // 使用Markdown格式
      text: `*请注意对方是骗子*！！ \n UID：${chatId}`
    });
  }
  if (enable_notification) {
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" });
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + chatId, Date.now());
      return sendMessage({
        chat_id: ADMIN_UID,
        text: await fetch(notificationUrl).then(r => r.text())
      });
    }
  }
}


/**
 * 屏蔽用户 (管理员专用，需要回复用户消息)
 * @param {object} message Telegram message object
 * @returns {Promise<Response>}
 */
async function handleBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (guestChatId === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    });
  }
  const userInfo = await getUserInfo(guestChatId);
  const nickname = getUserNickname(userInfo, guestChatId);
  await nfd.put('isblocked-' + guestChatId, true);

  blockedUsers.push(guestChatId); // 添加到本地数组
  await saveBlockedUsers(); // 保存更新后的列表

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已被屏蔽`,
  });
}


/**
 * 解除屏蔽用户 (管理员专用，需要回复用户消息)
 * @param {object} message Telegram message object
 * @returns {Promise<Response>}
 */
async function handleUnBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  const userInfo = await getUserInfo(guestChatId);
  const nickname = getUserNickname(userInfo, guestChatId);
  await nfd.put('isblocked-' + guestChatId, false);

  const index = blockedUsers.indexOf(guestChatId);
  if (index > -1) {
    blockedUsers.splice(index, 1); // 从本地数组中移除
    await saveBlockedUsers(); // 保存更新后的列表
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已解除屏蔽`,
  });
}


/**
 * 检查用户是否被屏蔽 (管理员专用，需要回复用户消息)
 * @param {object} message Telegram message object
 * @returns {Promise<Response>}
 */
async function checkBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  let isBlocked = await nfd.get('isblocked-' + guestChatId, { type: "json" });
  const userInfo = await getUserInfo(guestChatId);
  const nickname = getUserNickname(userInfo, guestChatId);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname}` + (isBlocked ? ' 已被屏蔽' : ' 未被屏蔽')
  });
}


/**
 * 列出所有被屏蔽的用户 (管理员专用)
 * @returns {Promise<Response>}
 */
async function listBlockedUsers() {
  if (blockedUsers.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '没有被屏蔽的用户。'
    });
  } else {
    const blockedListText = await Promise.all(blockedUsers.map(async (uid, index) => {
      const userInfo = await getUserInfo(uid);
      const nickname = getUserNickname(userInfo, uid);
      return `${index + 1}. UID: ${uid}, 昵称: ${nickname}`;
    }));
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `被屏蔽的用户列表:\n${blockedListText.join('\n')}`
    });
  }
}


/**
 *  根据序号解除屏蔽用户 (管理员专用)
 * @param {number} index 屏蔽列表序号
 * @returns {Promise<Response>}
 */
async function unblockByIndex(index) {
  if (index < 1 || index > blockedUsers.length) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无效的序号。'
    });
  }
  const guestChatId = blockedUsers[index - 1];
  await nfd.put('isblocked-' + guestChatId, false); // 确保键名一致
  blockedUsers.splice(index - 1, 1); // 从本地数组中移除
  await saveBlockedUsers(); // 保存更新后的列表
  const userInfo = await getUserInfo(guestChatId);
  const nickname = getUserNickname(userInfo, guestChatId);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已解除屏蔽`,
  });
}



//Send plain text message
//https://core.telegram.org/bots/api#sendmessage

async function sendPlainText(chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  });
}

//
//  Set webhook to this worker's url
//  https://core.telegram.org/bots/api#setwebhook

async function registerWebhook(event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

//
// Remove webhook
// https://core.telegram.org/bots/api#setwebhook

async function unRegisterWebhook(event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 *  检查用户ID是否在欺诈列表中
 *  先检查本地列表，再检查远程欺诈数据库
 * @param {string} id 用户ID
 * @returns {boolean} 如果是骗子返回 true，否则返回 false
 */
async function isFraud(id) {
  id = id.toString();
  if (localFraudList.includes(id)) {
    return true;
  }
  try {
    let db = await fetch(fraudDb).then(r => r.text());
    let arr = db.split('\n').filter(v => v);
    return arr.includes(id);
  } catch (error) {
    console.error(`Error fetching fraud database:`, error);
    return false; // 远程数据库获取失败，默认不认为是骗子，或者可以根据策略调整
  }
}

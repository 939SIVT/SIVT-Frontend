/**
 * SIVT 科學探究虛擬教師 - 前端應用
 */

// ========================================
// 後端網址設定 (請修改這裡)
// ========================================
const API_BASE_URL = 'https://unurged-marivel-unawaking.ngrok-free.dev';
// ========================================

// DOM 元素
let chatContainer, messageInput, sendBtn, clearBtn, modelSelect, statusIndicator, voiceBtn;
let attachmentBtn, fileInput, splitLayout, videoPanel, mainPlayer, statusOverlay, resizer;
let loginOverlay, usernameInput, loginBtn;

// 狀態
let isLoading = false;
let currentPhase = 1;
let currentVideoStatus = { is_processing: false, current_stage: null, error: null };

// Session 狀態
let currentSessionId = null;
let currentUsername = null;

// 語音相關
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentAudio = null;

// 影片處理狀態輪詢
let videoPollInterval = null;

// 拖曳相關
let isResizing = false;

/**
 * 初始化應用
 */
async function init() {
    // 取得 DOM 元素
    chatContainer = document.getElementById('chat-container');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    clearBtn = document.getElementById('clear-btn'); // 可能已被移除，保留以免報錯
    modelSelect = document.getElementById('model-select'); // 可能已被移除
    statusIndicator = document.getElementById('status-indicator'); // 可能已被移除
    voiceBtn = document.getElementById('voice-btn');

    // 新的上傳按鈕
    attachmentBtn = document.getElementById('attachment-btn');
    fileInput = document.getElementById('file-upload');

    // 分割檢視元素
    splitLayout = document.getElementById('split-layout');
    videoPanel = document.getElementById('video-panel');
    mainPlayer = document.getElementById('main-player');
    statusOverlay = document.getElementById('status-overlay');
    resizer = document.getElementById('resizer');

    // 登入元素
    loginOverlay = document.getElementById('login-overlay');
    usernameInput = document.getElementById('username-input');
    loginBtn = document.getElementById('login-btn');

    // 初始化功能
    checkHealth();
    setupEventListeners();
    setupLoginListeners();
    setupResizer();
    autoResizeTextarea();
    // updatePhaseIndicator(1); // 暫時移除，因畫面改動可能已不需要或需重寫

    // 檢查是否有正在進行的影片處理
    pollVideoStatus();

    console.log('後端網址:', API_BASE_URL);
}

/**
 * 設置事件監聽器
 */
function setupEventListeners() {
    // 發送按鈕點擊
    sendBtn.addEventListener('click', sendMessage);

    // Enter 發送 (Shift+Enter 換行)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 輸入框自動調整高度
    messageInput.addEventListener('input', autoResizeTextarea);

    // 清除對話
    clearBtn.addEventListener('click', clearChat);

    // 模型切換
    modelSelect.addEventListener('change', () => {
        const model = modelSelect.value;
        const modelName = model === 'azure' ? 'Azure OpenAI' : 'OpenAI GPT';
        addSystemMessage(`已切換至 ${modelName}`);
    });

    // 語音按鈕事件（按住錄音）
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('mouseleave', () => {
        if (isRecording) stopRecording();
    });

    // 觸控設備支援
    voiceBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startRecording();
    });
    voiceBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopRecording();
    });

    // 影片上傳
    if (attachmentBtn) {
        attachmentBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', uploadFile);
    }

    // 快速開始按鈕
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-message');
            messageInput.value = message;
            sendMessage();
        });
    });
}

/**
 * 設置登入相關事件監聽器
 */
function setupLoginListeners() {
    // 登入按鈕點擊
    loginBtn.addEventListener('click', handleLogin);

    // Enter 鍵登入
    usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLogin();
        }
    });

    // 頁面關閉時結束 session
    window.addEventListener('beforeunload', () => {
        if (currentSessionId) {
            // 使用 fetch + keepalive 確保請求送出且 Content-Type 正確 (sendBeacon 預設 text/plain)
            fetch(`${API_BASE_URL}/api/session/end`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                },
                body: JSON.stringify({ session_id: currentSessionId }),
                keepalive: true
            });
        }
    });
}

/**
 * 處理使用者登入
 */
async function handleLogin() {
    const username = usernameInput.value.trim();

    if (!username) {
        usernameInput.classList.add('error');
        usernameInput.focus();
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = '連線中...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/session/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        if (data.success) {
            currentSessionId = data.session_id;
            currentUsername = data.username;

            // 隱藏登入對話框
            loginOverlay.classList.add('hidden');

            // 顯示歡迎訊息
            addSystemMessage(`歡迎，${currentUsername}！對話已開始記錄。`);

            console.log(`[Session] 已登入: ${currentUsername} (${currentSessionId})`);
        } else {
            addErrorMessage(data.error || '登入失敗');
            loginBtn.disabled = false;
            loginBtn.textContent = '開始探究';
        }

    } catch (error) {
        console.error('登入錯誤:', error);
        addErrorMessage('無法連接到伺服器');
        loginBtn.disabled = false;
        loginBtn.textContent = '開始探究';
    }
}

/**
 * 結束當前 session 並儲存
 */
async function endSession() {
    if (!currentSessionId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/session/end`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ session_id: currentSessionId })
        });

        const data = await response.json();

        if (data.success) {
            addSystemMessage(`對話記錄已儲存: ${data.filename}`);
            currentSessionId = null;
        }

    } catch (error) {
        console.error('結束 session 錯誤:', error);
    }
}

/**
 * 設置 Resizer 拖曳功能
 */
function setupResizer() {
    if (!resizer) return;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
        e.preventDefault(); // 防止文字選取
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const containerRect = splitLayout.getBoundingClientRect();
        const containerWidth = containerRect.width;
        // 計算滑鼠相對於容器左側的 X 座標
        const pointerRelativeX = e.clientX - containerRect.left;

        // 計算百分比，並設定限制 (20% ~ 80%)
        let percentage = (pointerRelativeX / containerWidth) * 100;
        percentage = Math.max(20, Math.min(80, percentage));

        videoPanel.style.width = `${percentage}%`;
        videoPanel.style.flex = `0 0 ${percentage}%`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('active');
            document.body.style.cursor = 'default';
        }
    });
}

/**
 * 上傳檔案（影片或圖片）
 */
async function uploadFile() {
    if (!fileInput.files || fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    // 如果是影片，走影片處理流程
    if (isVideo) {
        await uploadVideoFile(file);
    }
    // 如果是圖片，走圖片對話流程
    else if (isImage) {
        await uploadImageFile(file);
    }
    // 其他類型：嘗試當作文字檔案處理
    else {
        await uploadTextFile(file);
    }

    fileInput.value = '';
}

/**
 * 上傳影片檔案
 */
async function uploadVideoFile(file) {
    const formData = new FormData();
    formData.append('video', file);

    if (attachmentBtn) attachmentBtn.disabled = true;

    // 切換到分割檢視
    splitLayout.classList.add('has-video');
    videoPanel.style.display = 'flex';
    statusOverlay.style.display = 'flex';

    // 重置步驟狀態
    resetStepStatus();

    try {
        const response = await fetch(`${API_BASE_URL}/api/upload-video`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            // 設定影片來源
            mainPlayer.src = URL.createObjectURL(file);
            // 嘗試自動播放（靜音）以獲取縮圖，但不要干擾使用者
            mainPlayer.muted = true;

            pollVideoStatus();
        } else {
            addErrorMessage(`上傳失敗: ${data.error}`);
            if (attachmentBtn) attachmentBtn.disabled = false;
            statusOverlay.style.display = 'none';
        }

    } catch (error) {
        console.error('上傳錯誤:', error);
        addErrorMessage('影片上傳發生錯誤');
        if (attachmentBtn) attachmentBtn.disabled = false;
        statusOverlay.style.display = 'none';
    }
}

/**
 * 上傳圖片並與 AI 對話
 */
async function uploadImageFile(file) {
    // 清除歡迎區域
    const welcomeSection = chatContainer.querySelector('.welcome-section');
    if (welcomeSection) {
        welcomeSection.remove();
    }

    // 顯示圖片預覽訊息
    const imageUrl = URL.createObjectURL(file);
    addImageMessage(imageUrl, file.name);

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();
    isLoading = true;
    sendBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('message', '請仔細觀察這張圖片，描述你看到的內容，並思考其中可能蘊含的科學原理或探究問題。');
        formData.append('provider', modelSelect.value);

        const response = await fetch(`${API_BASE_URL}/api/chat-with-image`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            body: formData
        });

        const data = await response.json();
        typingIndicator.remove();

        if (data.success) {
            addMessage(data.response, 'ai', data.provider);

            // 更新探究歷程指示器
            if (data.phase) {
                updatePhaseIndicator(data.phase);
            }
        } else {
            addErrorMessage(data.error || '圖片分析失敗');
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('無法連接到伺服器進行圖片分析');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
    }
}

/**
 * 上傳文字檔案
 */
async function uploadTextFile(file) {
    // 清除歡迎區域
    const welcomeSection = chatContainer.querySelector('.welcome-section');
    if (welcomeSection) {
        welcomeSection.remove();
    }

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();
    isLoading = true;

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE_URL}/api/upload-file`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            body: formData
        });

        const data = await response.json();
        typingIndicator.remove();

        if (data.success && data.type === 'text') {
            addSystemMessage(`已上傳檔案: ${file.name} (${data.char_count} 字)`);
            // 顯示部分內容預覽
            const preview = data.content.substring(0, 500);
            addMessage(`檔案內容預覽：\n\n${preview}${data.content.length > 500 ? '...' : ''}`, 'ai');
        } else {
            addErrorMessage(data.error || '檔案處理失敗');
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('檔案上傳失敗');
    } finally {
        isLoading = false;
    }
}

/**
 * 添加圖片訊息到聊天區
 */
function addImageMessage(imageUrl, filename) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="uploaded-image-container">
                <img src="${imageUrl}" alt="${filename}" class="uploaded-image" onclick="window.open('${imageUrl}', '_blank')">
                <span class="image-filename">${filename}</span>
            </div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

/**
 * 重置步驟狀態顯示
 */
function resetStepStatus() {
    ['step-transcribe', 'step-extract', 'step-ingest'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'progress-step';
    });
}

/**
 * 更新步驟狀態 (適配新 UI)
 */
function updateStepUI(stage) {
    const stages = ['transcribing', 'extracting_images', 'ingesting', 'completed'];
    const stepIds = ['step-transcribe', 'step-extract', 'step-ingest'];

    // 如果是 starting 或其他未定義狀態，視為第一步
    let activeIdx = stages.indexOf(stage);
    if (stage && activeIdx === -1 && stage !== 'error') {
        activeIdx = 0;
    }

    stepIds.forEach((id, idx) => {
        const el = document.getElementById(id);
        if (!el) return;

        // 清除舊狀態
        el.classList.remove('active', 'completed');

        if (idx < activeIdx) {
            el.classList.add('completed');
        } else if (idx === activeIdx && stage !== 'completed') {
            el.classList.add('active');
        } else if (stage === 'completed') {
            el.classList.add('completed');
        } else {
            // 未開始的步驟保持預設樣式
        }
    });
}

function getStepText(idx) {
    if (idx === 0) return '生成逐字稿';
    if (idx === 1) return '擷取關鍵畫面';
    if (idx === 2) return '建立知識庫';
    return '';
}

/**
 * 更新影片狀態顯示
 */
function updateVideoStatus(msg, type) { // type: 'processing', 'success', 'error'
    videoStatus.style.display = 'block';
    videoStatus.querySelector('.status-msg').textContent = msg;

    videoStatus.className = 'video-status ' + type;
}

/**
 * 輪詢影片處理狀態
 */
function pollVideoStatus() {
    if (videoPollInterval) clearInterval(videoPollInterval);

    videoPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/video-status`, {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            const status = await response.json();
            currentVideoStatus = status;

            console.log('[Status Poll]', status); // Debug log

            if (status.is_processing) {
                if (attachmentBtn) attachmentBtn.disabled = true;

                // 確保面板開啟
                if (!splitLayout.classList.contains('has-video')) {
                    splitLayout.classList.add('has-video');
                    videoPanel.style.display = 'flex';
                    statusOverlay.style.display = 'flex';
                }

                // 確保遮罩顯示
                if (statusOverlay.style.display === 'none') {
                    statusOverlay.style.display = 'flex';
                }

                updateStepUI(status.current_stage);

            } else {
                if (status.error) {
                    addErrorMessage(`影片處理失敗: ${status.error}`);
                    statusOverlay.style.display = 'none';
                    if (attachmentBtn) attachmentBtn.disabled = false;
                } else if (status.current_stage === 'completed') {
                    // 處理完成
                    updateStepUI('completed');

                    // 延遲一下再隱藏遮罩
                    setTimeout(() => {
                        console.log('Hiding overlay...');
                        statusOverlay.style.display = 'none';
                        // 播放影片
                        if (mainPlayer) {
                            mainPlayer.muted = false; // 取消靜音
                            // mainPlayer.play().catch(e => console.log('Auto-play blocked:', e));
                        }
                    }, 1500);

                    if (attachmentBtn && attachmentBtn.disabled) {
                        attachmentBtn.disabled = false;
                    }
                } else {
                    // 閒置或重置
                    if (statusOverlay.style.display !== 'none' && !status.is_processing) {
                        statusOverlay.style.display = 'none';
                    }
                    if (attachmentBtn) attachmentBtn.disabled = false;
                }

                if (!status.is_processing) {
                    clearInterval(videoPollInterval);
                    videoPollInterval = null;
                }
            }
        } catch (e) {
            console.error('Status poll error:', e);
            // Don't stop polling on network error immediately, maybe retry?
            // checking 'is_processing' false will stop it anyway. 
        }
    }, 1000); // Poll every 1 second for smoother UI
}

/**
 * 自動調整輸入框高度
 */
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

/**
 * 檢查後端健康狀態
 */
async function checkHealth() {
    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('.status-text');

    try {
        const response = await fetch(`${API_BASE_URL}/api/health`, {
            headers: {
                'ngrok-skip-browser-warning': 'true'
            }
        });

        // 確認是 JSON 回應且 status 為 ok
        const data = await response.json();

        if (response.ok && data.status === 'ok') {
            statusDot.className = 'status-dot online';
            statusText.textContent = '已連線';
        } else {
            throw new Error('Invalid response');
        }
    } catch (error) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = '連線失敗';
    }
}

/**
 * 更新探究歷程指示器
 */
function updatePhaseIndicator(phase) {
    if (phase < 1 || phase > 4) return;

    currentPhase = phase;

    // 更新所有階段項目
    document.querySelectorAll('.phase-item').forEach((item, index) => {
        const itemPhase = index + 1;

        if (itemPhase < phase) {
            // 已完成的階段
            item.classList.remove('active');
            item.classList.add('completed');
        } else if (itemPhase === phase) {
            // 當前階段
            item.classList.add('active');
            item.classList.remove('completed');
        } else {
            // 未到達的階段
            item.classList.remove('active', 'completed');
        }
    });
}

/**
 * 發送訊息
 */
async function sendMessage() {
    const message = messageInput.value.trim();

    if (!message || isLoading) return;

    // 清除歡迎區域
    const welcomeSection = chatContainer.querySelector('.welcome-section');
    if (welcomeSection) {
        welcomeSection.remove();
    }

    // 添加使用者訊息
    addMessage(message, 'user');

    // 清空輸入框
    messageInput.value = '';
    autoResizeTextarea();

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();

    // 設置載入狀態
    isLoading = true;
    sendBtn.disabled = true;

    try {
        const provider = modelSelect.value;

        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                message: message,
                provider: provider,
                session_id: currentSessionId  // 加入 session_id 以記錄對話
            })
        });

        const data = await response.json();

        // 移除載入動畫
        typingIndicator.remove();

        if (data.success) {
            addMessage(data.response, 'ai', data.provider, data.rag_images);

            // 更新探究歷程指示器
            if (data.phase) {
                updatePhaseIndicator(data.phase);
            }
        } else {
            addErrorMessage(data.error || '發生未知錯誤');
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('無法連接到伺服器，請確認後端服務是否運行');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

/**
 * 開始錄音
 */
async function startRecording() {
    if (isRecording || isLoading) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });

        audioChunks = [];

        mediaRecorder.addEventListener('dataavailable', (event) => {
            audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener('stop', async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendVoiceToText(audioBlob);

            // 停止所有音訊軌道
            stream.getTracks().forEach(track => track.stop());
        });

        mediaRecorder.start();
        isRecording = true;

        // 更新 UI
        voiceBtn.classList.add('recording');
        addSystemMessage('正在錄音中，放開按鈕停止...');

    } catch (error) {
        console.error('無法存取麥克風:', error);
        addErrorMessage('無法存取麥克風，請確認已授予麥克風權限');
    }
}

/**
 * 停止錄音
 */
function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    voiceBtn.classList.remove('recording');
    mediaRecorder.stop();
}

/**
 * 將語音傳送到後端轉文字
 */
async function sendVoiceToText(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();
    isLoading = true;
    sendBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/speech-to-text`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            body: formData
        });

        const data = await response.json();
        typingIndicator.remove();

        if (data.success && data.text) {
            // 將辨識結果填入輸入框
            messageInput.value = data.text;
            autoResizeTextarea();

            // 重置 loading 狀態後再發送訊息
            isLoading = false;
            sendBtn.disabled = false;

            // 自動發送訊息
            sendMessage();
        } else {
            addErrorMessage(data.error || '語音辨識失敗');
            isLoading = false;
            sendBtn.disabled = false;
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('語音辨識服務無法連接');
        isLoading = false;
        sendBtn.disabled = false;
    }
}

/**
 * 播放 AI 回覆的語音（帶字幕效果）
 */
async function playAIVoiceWithCaption(text, messageElement) {
    const contentDiv = messageElement.querySelector('.message-content');
    const voiceTextDiv = messageElement.querySelector('.voice-text');
    const loadingIndicator = messageElement.querySelector('.voice-loading-indicator');

    try {
        console.log('[TTS] 開始請求語音合成:', text.substring(0, 50) + '...');

        const response = await fetch(`${API_BASE_URL}/api/text-to-speech`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                text: text,
                voice: 'nova'  // 使用 nova 聲音（女聲，適合教學）
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TTS] 服務失敗:', response.status, errorText);
            // 失敗時直接顯示完整文字
            if (loadingIndicator) loadingIndicator.remove();
            if (voiceTextDiv) {
                voiceTextDiv.innerHTML = formatMessage(text);
                voiceTextDiv.style.display = 'block';
            }
            contentDiv.classList.remove('voice-loading');
            throw new Error('TTS 服務失敗');
        }

        const audioBlob = await response.blob();
        console.log('[TTS] 接收到音訊:', audioBlob.size, 'bytes');

        const audioUrl = URL.createObjectURL(audioBlob);

        // 停止當前播放的音訊
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        // 建立並播放新音訊
        const audio = new Audio(audioUrl);
        currentAudio = audio;

        // 取得音訊時長（需要載入後才知道）
        audio.addEventListener('loadedmetadata', () => {
            const duration = audio.duration;
            console.log('[TTS] 音訊時長:', duration, '秒');

            // 開始打字機效果
            startTypingEffect(voiceTextDiv, text, duration, contentDiv, loadingIndicator);
        });

        // 加入播放控制按鈕
        addAudioControls(messageElement, audio, contentDiv);

        // 自動播放
        console.log('[TTS] 開始播放語音');
        audio.play();

        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
            console.log('[TTS] 播放完成');
        });

    } catch (error) {
        console.error('[TTS] 語音播放失敗:', error);
        // 失敗時確保文字正常顯示
        if (loadingIndicator) loadingIndicator.remove();
        if (voiceTextDiv) {
            voiceTextDiv.innerHTML = formatMessage(text);
            voiceTextDiv.style.display = 'block';
        }
        contentDiv.classList.remove('voice-loading');
    }
}

/**
 * 打字機效果 - 逐字顯示文字
 */
function startTypingEffect(voiceTextDiv, fullText, duration, contentDiv, loadingIndicator) {
    if (!voiceTextDiv) return;

    // 移除載入指示器
    if (loadingIndicator) {
        loadingIndicator.remove();
    }

    // 顯示文字容器
    voiceTextDiv.style.display = 'block';
    contentDiv.classList.remove('voice-loading');
    contentDiv.classList.add('voice-typing');

    // 計算打字速度（每個字元的顯示時間）
    const charCount = fullText.length;
    const charDelay = (duration * 1000) / charCount; // 毫秒

    let currentIndex = 0;
    let displayedText = '';

    const typingInterval = setInterval(() => {
        if (currentIndex < charCount) {
            displayedText += fullText[currentIndex];
            voiceTextDiv.innerHTML = formatMessage(displayedText);
            currentIndex++;
        } else {
            clearInterval(typingInterval);
            contentDiv.classList.remove('voice-typing');
            contentDiv.classList.add('voice-completed');
        }
    }, charDelay);

    // 儲存 interval ID 以便在需要時可以清除
    voiceTextDiv.dataset.typingInterval = typingInterval;
}

/**
 * 在訊息中加入音訊控制按鈕
 */
function addAudioControls(messageElement, audio, contentDiv) {
    if (!contentDiv) {
        contentDiv = messageElement.querySelector('.message-content');
    }
    if (!contentDiv) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'audio-controls';

    // 播放/暫停按鈕
    const playBtn = document.createElement('button');
    playBtn.className = 'audio-play-btn';
    playBtn.title = '暫停播放';
    playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="2"/>
            <rect x="14" y="4" width="4" height="16" rx="2"/>
        </svg>
    `;

    let isPlaying = true;

    playBtn.addEventListener('click', () => {
        if (isPlaying) {
            audio.pause();
            playBtn.title = '繼續播放';
            playBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
        } else {
            audio.play();
            playBtn.title = '暫停播放';
            playBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="2"/>
                    <rect x="14" y="4" width="4" height="16" rx="2"/>
                </svg>
            `;
        }
        isPlaying = !isPlaying;
    });

    audio.addEventListener('play', () => {
        isPlaying = true;
        playBtn.title = '暫停播放';
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="2"/>
                <rect x="14" y="4" width="4" height="16" rx="2"/>
            </svg>
        `;
    });

    audio.addEventListener('pause', () => {
        isPlaying = false;
        playBtn.title = '繼續播放';
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    });

    controlsDiv.appendChild(playBtn);
    contentDiv.appendChild(controlsDiv);
}

/**
 * 添加訊息到聊天區
 */


// 輔助函數：跳脫 HTML 用於 data 屬性
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
}

/**
 * 格式化訊息內容
 */
function formatMessage(content) {
    // 基本的 HTML 跳脫
    let formatted = escapeHtml(content);

    // 將 **粗體** 轉換
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 保留換行
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}

/**
 * 添加系統訊息
 */
function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.style.cssText = `
        align-self: center;
        max-width: 100%;
    `;
    messageDiv.innerHTML = `
        <div class="message-bubble" style="
            background: rgba(14, 165, 233, 0.1);
            border: 1px solid rgba(14, 165, 233, 0.3);
            font-size: 0.8rem;
            color: var(--text-secondary);
            padding: 8px 16px;
        ">
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

/**
 * 添加錯誤訊息
 */
function addErrorMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    messageDiv.innerHTML = `
        <div class="message-header" style="color: var(--error-color);">
            <span>錯誤</span>
        </div>
        <div class="message-bubble" style="border-color: var(--error-color);">
            <div class="message-content" style="color: var(--error-color);">${escapeHtml(content)}</div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

/**
 * 顯示打字指示器
 */
function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    chatContainer.appendChild(indicator);
    scrollToBottom();
    return indicator;
}

/**
 * 清除對話
 */
function clearChat() {
    // 重置階段
    updatePhaseIndicator(1);

    chatContainer.innerHTML = `
        <div class="welcome-section">
            <div class="welcome-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                </svg>
            </div>
            <h2>歡迎來到科學探究教室</h2>
            <p>我是你的虛擬科學教師，將引導你完成探究學習的四大歷程</p>
            <div class="quick-start">
                <p class="hint">你可以嘗試這樣開始：</p>
                <div class="suggestion-chips">
                    <button class="chip" data-message="我想開始進行科學探究">開始探究</button>
                    <button class="chip" data-message="什麼是科學探究？">什麼是探究?</button>
                    <button class="chip" data-message="請說明探究的四個歷程">四大歷程</button>
                </div>
            </div>
        </div>
    `;

    // 重新綁定快速開始按鈕事件
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-message');
            messageInput.value = message;
            sendMessage();
        });
    });
}

/**
 * 滾動到底部
 */
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * HTML 跳脫
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 啟動應用
document.addEventListener('DOMContentLoaded', init);

/**
 * 自動調整輸入框高度
 */
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

/**
 * 檢查後端健康狀態
 */
async function checkHealth() {
    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('.status-text');

    try {
        const response = await fetch(`${API_BASE_URL}/api/health`, {
            headers: {
                'ngrok-skip-browser-warning': 'true'
            }
        });

        // 確認是 JSON 回應且 status 為 ok
        const data = await response.json();

        if (response.ok && data.status === 'ok') {
            statusDot.className = 'status-dot online';
            statusText.textContent = '已連線';
        } else {
            throw new Error('Invalid response');
        }
    } catch (error) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = '連線失敗';
    }
}

/**
 * 更新探究歷程指示器
 */
function updatePhaseIndicator(phase) {
    if (phase < 1 || phase > 4) return;

    currentPhase = phase;

    // 更新所有階段項目
    document.querySelectorAll('.phase-item').forEach((item, index) => {
        const itemPhase = index + 1;

        if (itemPhase < phase) {
            // 已完成的階段
            item.classList.remove('active');
            item.classList.add('completed');
        } else if (itemPhase === phase) {
            // 當前階段
            item.classList.add('active');
            item.classList.remove('completed');
        } else {
            // 未到達的階段
            item.classList.remove('active', 'completed');
        }
    });
}

/**
 * 擷取影片當前畫面
 */
function captureVideoFrame() {
    // 只要有播放器、有來源，且足以播放當前影格 (readyState >= 2)，就允許截圖
    // 移除 mainPlayer.paused 檢查，因為使用者通常會暫停影片來問問題
    if (!mainPlayer || !mainPlayer.src || mainPlayer.readyState < 2) return null;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = mainPlayer.videoWidth;
        canvas.height = mainPlayer.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(mainPlayer, 0, 0, canvas.width, canvas.height);

        console.log("已擷取當前畫面");
        // 轉為 Base64 JPEG (品質 0.6 以減少傳輸量)
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch (e) {
        console.error("截圖失敗:", e);
        return null;
    }
}

/**
 * 發送訊息
 */
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading) return;

    const currentModel = modelSelect.value;

    // 擷取當前畫面 (如果有的話)
    const currentFrame = captureVideoFrame();

    // 清除歡迎區域
    const welcomeSection = chatContainer.querySelector('.welcome-section');
    if (welcomeSection) {
        welcomeSection.remove();
    }

    // 添加使用者訊息
    addMessage(message, 'user');

    // 清空輸入框
    messageInput.value = '';
    messageInput.style.height = 'auto'; // Reset height

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();

    // 設置載入狀態
    isLoading = true;
    sendBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                message: message,
                provider: currentModel, // Changed from 'provider' to 'model'
                current_frame: currentFrame, // 傳送當前畫面 Base64
                session_id: currentSessionId // 加入 session_id 以記錄對話
            })
        });

        const data = await response.json();

        // 移除載入動畫
        typingIndicator.remove();

        if (data.success) {
            addMessage(data.response, 'ai', data.provider, data.rag_images, data.message_id);

            // 更新探究歷程指示器
            if (data.phase) {
                updatePhaseIndicator(data.phase);
            }
        } else {
            addErrorMessage(data.error || '發生未知錯誤');
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('無法連接到伺服器，請確認後端服務是否運行');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

/**
 * 開始錄音
 */
async function startRecording() {
    if (isRecording || isLoading) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });

        audioChunks = [];

        mediaRecorder.addEventListener('dataavailable', (event) => {
            audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener('stop', async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendVoiceToText(audioBlob);

            // 停止所有音訊軌道
            stream.getTracks().forEach(track => track.stop());
        });

        mediaRecorder.start();
        isRecording = true;

        // 更新 UI
        voiceBtn.classList.add('recording');
        addSystemMessage('正在錄音中，放開按鈕停止...');

    } catch (error) {
        console.error('無法存取麥克風:', error);
        addErrorMessage('無法存取麥克風，請確認已授予麥克風權限');
    }
}

/**
 * 停止錄音
 */
function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    voiceBtn.classList.remove('recording');
    mediaRecorder.stop();
}

/**
 * 將語音傳送到後端轉文字
 */
async function sendVoiceToText(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    // 顯示載入動畫
    const typingIndicator = showTypingIndicator();
    isLoading = true;
    sendBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/speech-to-text`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            body: formData
        });

        const data = await response.json();
        typingIndicator.remove();

        if (data.success && data.text) {
            // 將辨識結果填入輸入框
            messageInput.value = data.text;
            autoResizeTextarea();

            // 重置 loading 狀態後再發送訊息
            isLoading = false;
            sendBtn.disabled = false;

            // 自動發送訊息
            sendMessage();
        } else {
            addErrorMessage(data.error || '語音辨識失敗');
            isLoading = false;
            sendBtn.disabled = false;
        }

    } catch (error) {
        typingIndicator.remove();
        addErrorMessage('語音辨識服務無法連接');
        isLoading = false;
        sendBtn.disabled = false;
    }
}

/**
 * 播放 AI 回覆的語音（帶字幕效果）
 */
async function playAIVoiceWithCaption(text, messageElement) {
    const contentDiv = messageElement.querySelector('.message-content');
    const voiceTextDiv = messageElement.querySelector('.voice-text');
    const loadingIndicator = messageElement.querySelector('.voice-loading-indicator');

    try {
        console.log('[TTS] 開始請求語音合成:', text.substring(0, 50) + '...');

        const response = await fetch(`${API_BASE_URL}/api/text-to-speech`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                text: text,
                voice: 'nova'  // 使用 nova 聲音（女聲，適合教學）
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TTS] 服務失敗:', response.status, errorText);
            // 失敗時直接顯示完整文字
            if (loadingIndicator) loadingIndicator.remove();
            if (voiceTextDiv) {
                voiceTextDiv.innerHTML = formatMessage(text);
                voiceTextDiv.style.display = 'block';
            }
            contentDiv.classList.remove('voice-loading');
            throw new Error('TTS 服務失敗');
        }

        const audioBlob = await response.blob();
        console.log('[TTS] 接收到音訊:', audioBlob.size, 'bytes');

        const audioUrl = URL.createObjectURL(audioBlob);

        // 停止當前播放的音訊
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        // 建立並播放新音訊
        const audio = new Audio(audioUrl);
        currentAudio = audio;

        // 取得音訊時長（需要載入後才知道）
        audio.addEventListener('loadedmetadata', () => {
            const duration = audio.duration;
            console.log('[TTS] 音訊時長:', duration, '秒');

            // 開始打字機效果
            startTypingEffect(voiceTextDiv, text, duration, contentDiv, loadingIndicator);
        });

        // 加入播放控制按鈕
        addAudioControls(messageElement, audio, contentDiv);

        // 自動播放
        console.log('[TTS] 開始播放語音');
        audio.play();

        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
            console.log('[TTS] 播放完成');
        });

    } catch (error) {
        console.error('[TTS] 語音播放失敗:', error);
        // 失敗時確保文字正常顯示
        if (loadingIndicator) loadingIndicator.remove();
        if (voiceTextDiv) {
            voiceTextDiv.innerHTML = formatMessage(text);
            voiceTextDiv.style.display = 'block';
        }
        contentDiv.classList.remove('voice-loading');
    }
}

/**
 * 打字機效果 - 逐字顯示文字
 */
function startTypingEffect(voiceTextDiv, fullText, duration, contentDiv, loadingIndicator) {
    if (!voiceTextDiv) return;

    // 移除載入指示器
    if (loadingIndicator) {
        loadingIndicator.remove();
    }

    // 顯示文字容器
    voiceTextDiv.style.display = 'block';
    contentDiv.classList.remove('voice-loading');
    contentDiv.classList.add('voice-typing');

    // 計算打字速度（每個字元的顯示時間）
    const charCount = fullText.length;
    const charDelay = (duration * 1000) / charCount; // 毫秒

    let currentIndex = 0;
    let displayedText = '';

    const typingInterval = setInterval(() => {
        if (currentIndex < charCount) {
            displayedText += fullText[currentIndex];
            voiceTextDiv.innerHTML = formatMessage(displayedText);
            currentIndex++;
        } else {
            clearInterval(typingInterval);
            contentDiv.classList.remove('voice-typing');
            contentDiv.classList.add('voice-completed');
        }
    }, charDelay);

    // 儲存 interval ID 以便在需要時可以清除
    voiceTextDiv.dataset.typingInterval = typingInterval;
}

/**
 * 在訊息中加入音訊控制按鈕
 */
function addAudioControls(messageElement, audio, contentDiv) {
    if (!contentDiv) {
        contentDiv = messageElement.querySelector('.message-content');
    }
    if (!contentDiv) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'audio-controls';

    // 播放/暫停按鈕
    const playBtn = document.createElement('button');
    playBtn.className = 'audio-play-btn';
    playBtn.title = '暫停播放';
    playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="2"/>
            <rect x="14" y="4" width="4" height="16" rx="2"/>
        </svg>
    `;

    let isPlaying = true;

    playBtn.addEventListener('click', () => {
        if (isPlaying) {
            audio.pause();
            playBtn.title = '繼續播放';
            playBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
        } else {
            audio.play();
            playBtn.title = '暫停播放';
            playBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="2"/>
                    <rect x="14" y="4" width="4" height="16" rx="2"/>
                </svg>
            `;
        }
        isPlaying = !isPlaying;
    });

    audio.addEventListener('play', () => {
        isPlaying = true;
        playBtn.title = '暫停播放';
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="2"/>
                <rect x="14" y="4" width="4" height="16" rx="2"/>
            </svg>
        `;
    });

    audio.addEventListener('pause', () => {
        isPlaying = false;
        playBtn.title = '繼續播放';
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    });

    controlsDiv.appendChild(playBtn);
    contentDiv.appendChild(controlsDiv);
}

/**
 * 添加訊息到聊天區
 */
function addMessage(content, type, provider = null, ragImages = [], messageId = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    let headerText = '';
    if (type === 'user') {
        headerText = '你';
    } else {
        headerText = provider === 'openai' ? 'OpenAI' : 'Azure';
    }

    // 為 AI 訊息建立特殊的內容結構
    if (type === 'ai') {
        let imageHtml = '';
        if (ragImages && ragImages.length > 0) {
            // 數據來源呈現 (簡化版)
            imageHtml = `
            <div class="rag-source-container">
                ${ragImages.map(url => {
                const filename = url.split('/').pop().replace(/%20/g, ' '); // 簡單解碼檔名
                return `
                        <div class="rag-simple-pill" onclick="window.open('${API_BASE_URL}${url}', '_blank')">
                            <span>${filename}</span>
                        </div>`;
            }).join('')}
            </div>`;
        }

        let feedbackHtml = '';
        if (messageId) {
            feedbackHtml = `
            <div class="feedback-actions">
                <button class="feedback-btn like" onclick="submitFeedback('${messageId}', 1, this)" title="有幫助">
                    <svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                </button>
                <button class="feedback-btn dislike" onclick="submitFeedback('${messageId}', -1, this)" title="沒幫助">
                    <svg viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>
                </button>
            </div>`;
        }

        messageDiv.innerHTML = `
            <div class="message-header">
                <span>${headerText}</span>
            </div>
            <div class="message-bubble">
                <div class="message-content voice-loading">
                    <div class="voice-loading-indicator">
                        <span></span><span></span><span></span>
                    </div>
                    <div class="voice-text" style="display: none;" data-full-text="${escapeHtml(content)}"></div>
                </div>
                ${imageHtml}
                ${feedbackHtml}
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">
                <span>${headerText}</span>
            </div>
            <div class="message-bubble">
                <div class="message-content">${formatMessage(content)}</div>
            </div>
        `;
    }

    chatContainer.appendChild(messageDiv);
    scrollToBottom();

    // 如果是 AI 訊息，自動播放語音並加入字幕效果
    if (type === 'ai') {
        playAIVoiceWithCaption(content, messageDiv);
    }
}

// 輔助函數：跳脫 HTML 用於 data 屬性
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
}

/**
 * 格式化訊息內容
 */
function formatMessage(content) {
    // 基本的 HTML 跳脫
    let formatted = escapeHtml(content);

    // 將 **粗體** 轉換
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 保留換行
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}

/**
 * 添加系統訊息
 */
function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.style.cssText = `
        align-self: center;
        max-width: 100%;
    `;
    messageDiv.innerHTML = `
        <div class="message-bubble" style="
            background: rgba(14, 165, 233, 0.1);
            border: 1px solid rgba(14, 165, 233, 0.3);
            font-size: 0.8rem;
            color: var(--text-secondary);
            padding: 8px 16px;
        ">
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

/**
 * 添加錯誤訊息
 */
function addErrorMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    messageDiv.innerHTML = `
        <div class="message-header" style="color: var(--error-color);">
            <span>錯誤</span>
        </div>
        <div class="message-bubble" style="border-color: var(--error-color);">
            <div class="message-content" style="color: var(--error-color);">${escapeHtml(content)}</div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

/**
 * 顯示打字指示器
 */
function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    chatContainer.appendChild(indicator);
    scrollToBottom();
    return indicator;
}

/**
 * 清除對話
 */
function clearChat() {
    // 如果有活躍的 session，先結束並儲存
    if (currentSessionId) {
        endSession();
    }

    // 重置階段
    updatePhaseIndicator(1);

    chatContainer.innerHTML = `
        <div class="welcome-section">
            <div class="welcome-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                </svg>
            </div>
            <h2>歡迎來到科學探究教室</h2>
            <p>我是你的虛擬科學教師，將引導你完成探究學習的四大歷程</p>
            <div class="quick-start">
                <p class="hint">你可以嘗試這樣開始：</p>
                <div class="suggestion-chips">
                    <button class="chip" data-message="我想開始進行科學探究">開始探究</button>
                    <button class="chip" data-message="什麼是科學探究？">什麼是探究?</button>
                    <button class="chip" data-message="請說明探究的四個歷程">四大歷程</button>
                </div>
            </div>
        </div>
    `;

    // 重新綁定快速開始按鈕事件
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const message = chip.getAttribute('data-message');
            messageInput.value = message;
            sendMessage();
        });
    });
}

/**
 * 滾動到底部
 */
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * HTML 跳脫
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 送出回饋評分
 */
async function submitFeedback(messageId, rating, btnElement) {
    if (!currentSessionId) return;

    // 先移除所有 active 狀態 (樂觀 UI 更新)
    const container = btnElement.parentElement;
    const buttons = container.querySelectorAll('.feedback-btn');
    const wasActive = btnElement.classList.contains('active');

    buttons.forEach(btn => btn.classList.remove('active'));

    // 如果原本已經是 active，則這次點擊是取消 (rating = 0)
    // 但如果想簡化，就直接設為選中
    if (!wasActive) {
        btnElement.classList.add('active');
    } else {
        // 取消評分
        rating = 0;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                session_id: currentSessionId,
                message_id: messageId,
                rating: rating
            })
        });

        if (!response.ok) {
            console.error('Feedback failed:', await response.text());
            // 失敗時回滾 UI (這裡省略複雜回滾，假設成功)
        }
    } catch (e) {
        console.error('Feedback error:', e);
    }
}

// 啟動應用
document.addEventListener('DOMContentLoaded', init);

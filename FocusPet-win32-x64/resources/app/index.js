const { app, BrowserWindow, Tray, Menu, Notification, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');

let mainWindow;
let tray;
let isWorking = false;
let currentState = 'idle'; // 'idle', 'working', 'break'
let timer = null;
let workDuration = 25 * 60; // 25 minutes in seconds
let breakDuration = 5 * 60; // 5 minutes in seconds
let timeRemaining = workDuration;
let idleTime = 0;
let lastActivity = Date.now();
let streak = 0;
let motivationalQuotes = [];
let isVisible = true;

// Monitor mouse/keyboard activity
function resetIdleTime() {
  lastActivity = Date.now();
  idleTime = 0;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 300,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setPosition(width - 320, height - 420);
  
  // Allow pet dragging but snap back to edges
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    if (x < 0) mainWindow.setPosition(0, y);
    if (y < 0) mainWindow.setPosition(x, 0);
    if (x > width - 300) mainWindow.setPosition(width - 300, y);
    if (y > height - 400) mainWindow.setPosition(x, height - 400);
  });
  
  createTray();
  fetchMotivationalQuotes();
  startIdleMonitor();
  setupGlobalShortcuts();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Start Work Session', click: startWork },
    { label: 'Take Break', click: startBreak },
    { label: 'Get Motivation', click: showMotivation },
    { label: 'Hide/Show Pet', click: toggleVisibility },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Focus Companion');
  tray.setContextMenu(contextMenu);
}

function fetchMotivationalQuotes() {
  // Default quotes in case API fails
  motivationalQuotes = [
    "The secret of getting ahead is getting started.",
    "Don't watch the clock; do what it does. Keep going.",
    "The way to get started is to quit talking and begin doing.",
    "It always seems impossible until it's done.",
    "You are never too old to set another goal or to dream a new dream.",
    "Quality is not an act, it is a habit.",
    "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    "The only place where success comes before work is in the dictionary.",
    "Don't be afraid to give up the good to go for the great.",
    "You can't build a reputation on what you are going to do."
  ];
  
  // Try to fetch quotes from API
  const options = {
    hostname: 'api.quotable.io',
    path: '/quotes?tags=success|inspirational|work|productivity&limit=25',
    method: 'GET'
  };
  
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const quotes = JSON.parse(data);
        if (quotes && quotes.results && quotes.results.length > 0) {
          motivationalQuotes = quotes.results.map(q => q.content);
        }
      } catch (e) {
        console.error('Failed to parse quotes:', e);
      }
    });
  });
  
  req.on('error', error => {
    console.error('Error fetching quotes:', error);
  });
  
  req.end();
}

function getRandomQuote() {
  return motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
}

let lastNudgeTime = 0;

function startIdleMonitor() {
  // Check for inactivity every 60 seconds
  setInterval(() => {
    if (!isWorking) return; // Only nudge during work sessions
    
    const idle = Math.floor((Date.now() - lastActivity) / 1000);
    const timeSinceLastNudge = Math.floor((Date.now() - lastNudgeTime) / 1000);
    
    // Nudge if idle for more than 5 minutes (300s), and at least 5 minutes (300s) since last nudge
    if (idle >= 300 && timeSinceLastNudge >= 300) {
      idleTime = idle;
      lastNudgeTime = Date.now();
      showMotivation();
      movePetRandomly();
    }
  }, 60000);
}

function movePetRandomly() {
  if (!isVisible) return;
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.floor(Math.random() * (width - 300));
  const y = Math.floor(Math.random() * (height - 400));
  
  mainWindow.setPosition(x, y);
  sendToRenderer('animate', 'jump');
  
  // After 10 seconds, return to original position
  setTimeout(() => {
    mainWindow.setPosition(width - 320, height - 420);
  }, 10000);
}

function startWork() {
  isWorking = true;
  currentState = 'working';
  timeRemaining = workDuration;
  startTimer();
  resetIdleTime();
  sendToRenderer('updateState', { currentState, isWorking, timeRemaining, streak });
  
  new Notification({
    title: 'Work Session Started',
    body: 'Focus time! Your pet is watching you work.',
    silent: false
  }).show();
}

function startBreak() {
  isWorking = false;
  currentState = 'break';
  timeRemaining = breakDuration;
  startTimer();
  sendToRenderer('updateState', { currentState, isWorking, timeRemaining, streak });
  
  new Notification({
    title: 'Break Time!',
    body: 'Take a short break. You\'ve earned it!',
    silent: false
  }).show();
}

function showMotivation() {
  const quote = getRandomQuote();
  
  if (isVisible) {
    sendToRenderer('showMotivation', quote);
  }
  
  new Notification({
    title: 'Time to Focus!',
    body: quote,
    silent: true
  }).show();
}

function toggleVisibility() {
  isVisible = !isVisible;
  if (isVisible) {
    mainWindow.show();
  } else {
    mainWindow.hide();
  }
}

function setupGlobalShortcuts() {
  // Ctrl+Alt+F to show/hide
  globalShortcut.register('CommandOrControl+Alt+F', toggleVisibility);
  
  // Ctrl+Alt+W to start work
  globalShortcut.register('CommandOrControl+Alt+W', startWork);
  
  // Ctrl+Alt+B to start break
  globalShortcut.register('CommandOrControl+Alt+B', startBreak);

  // Ctrl+Alt+B to start break
  globalShortcut.register('CommandOrControl+Alt+M', showMotivation);
}

function resetTimer() {
  clearInterval(timer);
  timer = null;
  currentState = 'idle';
  timeRemaining = workDuration;
  sendToRenderer('updateState', { currentState, isWorking, timeRemaining, streak });
}

function startTimer() {
  clearInterval(timer);
  
  timer = setInterval(() => {
    timeRemaining--;
    
    if (timeRemaining <= 0) {
      clearInterval(timer);
      
      if (isWorking) {
        streak++;
        new Notification({
          title: 'Good job!',
          body: `Work session complete! You've completed ${streak} sessions today.`,
          silent: false
        }).show();
        startBreak();
      } else {
        new Notification({
          title: 'Break finished',
          body: 'Ready to get back to work?',
          silent: false
        }).show();
        showMotivation();
      }
    }
    
    sendToRenderer('updateTime', timeRemaining);
  }, 1000);
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Track activity
app.on('browser-window-focus', resetIdleTime);

// Add these lines near the end of your index.js file
// const { ipcMain } = require('electron');

ipcMain.on('start-work', () => {
  startWork();
});

ipcMain.on('start-break', () => {
  startBreak();
});

ipcMain.on('get-motivation', () => {
  showMotivation();
});

ipcMain.on('toggle-visibility', () => {
  toggleVisibility();
});

ipcMain.on('user-activity', () => {
  resetIdleTime();
});

ipcMain.on('ready', () => {
  sendToRenderer('updateState', { currentState, isWorking, timeRemaining, streak });
});
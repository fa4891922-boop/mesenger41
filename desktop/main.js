const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');

const PROD_URL = 'https://pearnet-frontend.onrender.com';
const DEV_URL = 'http://localhost:5173';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function waitForVite(url, retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, (res) => {
        resolve();
      }).on('error', () => {
        if (retries <= 0) return reject(new Error('Vite not ready'));
        retries--;
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 400,
    minHeight: 500,
    title: 'PearNet',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0b0e14',
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await waitForVite(DEV_URL).catch(() => {});
    win.loadURL(DEV_URL);
  } else {
    win.loadURL(PROD_URL);
  }

  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


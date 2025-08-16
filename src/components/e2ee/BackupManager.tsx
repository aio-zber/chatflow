'use client'

import React, { useState } from 'react';
import { Download, Upload, Shield, AlertTriangle, CheckCircle, Copy, Eye, EyeOff } from 'lucide-react';
import { BackupManager } from '@/lib/e2ee/BackupManager';

interface BackupManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackupManagerModal: React.FC<BackupManagerProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'create' | 'restore'>('create');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Encryption Backup
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ×
            </button>
          </div>

          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-4 py-2 font-medium text-sm ${
                activeTab === 'create'
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Create Backup
            </button>
            <button
              onClick={() => setActiveTab('restore')}
              className={`px-4 py-2 font-medium text-sm ${
                activeTab === 'restore'
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              Restore Backup
            </button>
          </div>

          {activeTab === 'create' && <CreateBackupTab />}
          {activeTab === 'restore' && <RestoreBackupTab />}
        </div>
      </div>
    </div>
  );
};

const CreateBackupTab: React.FC = () => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [useGeneratedPassphrase, setUseGeneratedPassphrase] = useState(false);
  const [generatedPassphrase, setGeneratedPassphrase] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [backupData, setBackupData] = useState<string | null>(null);

  const backupManager = new BackupManager();

  const generatePassphrase = () => {
    const generated = backupManager.generateSecurePassphrase();
    setGeneratedPassphrase(generated);
    setPassphrase(generated);
    setConfirmPassphrase(generated);
    setUseGeneratedPassphrase(true);
  };

  const createBackup = async () => {
    if (passphrase !== confirmPassphrase) {
      alert('Passphrases do not match');
      return;
    }

    if (passphrase.length < 12) {
      alert('Passphrase must be at least 12 characters long');
      return;
    }

    setIsCreating(true);

    try {
      const backup = await backupManager.createBackup(passphrase);
      const backupJson = JSON.stringify(backup, null, 2);
      setBackupData(backupJson);
    } catch (error) {
      console.error('Backup creation failed:', error);
      alert(`Backup creation failed: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const downloadBackup = () => {
    if (!backupData) return;

    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chatflow-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyPassphrase = async () => {
    await navigator.clipboard.writeText(useGeneratedPassphrase ? generatedPassphrase : passphrase);
  };

  if (backupData) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <h3 className="font-medium text-green-900">Backup Created Successfully</h3>
          </div>
          <p className="text-sm text-green-700">
            Your encryption keys have been backed up. Save this file and remember your passphrase.
          </p>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-yellow-900 mb-1">Important</h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• Store your passphrase in a secure location</li>
                <li>• Without the passphrase, the backup cannot be restored</li>
                <li>• We cannot recover your passphrase if you lose it</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={downloadBackup}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Download className="w-4 h-4" />
            Download Backup
          </button>
          <button
            onClick={copyPassphrase}
            className="px-4 py-2 text-blue-600 border border-blue-600 rounded hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">About Encryption Backups</h3>
        <p className="text-sm text-blue-700">
          Create a secure backup of your encryption keys. This allows you to restore your message 
          history on new devices or if you need to reinstall the app.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Backup Passphrase
          </label>
          
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={generatePassphrase}
                className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Generate Secure Passphrase
              </button>
            </div>

            <div className="relative">
              <input
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setUseGeneratedPassphrase(false);
                }}
                placeholder="Enter a strong passphrase (min 12 characters)"
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <input
              type={showPassphrase ? 'text' : 'password'}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Confirm passphrase"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-yellow-900 mb-1">Passphrase Requirements</h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• At least 12 characters long</li>
                <li>• Include uppercase, lowercase, numbers, and symbols</li>
                <li>• Store securely - we cannot recover it if lost</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={createBackup}
          disabled={isCreating || !passphrase || passphrase !== confirmPassphrase}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating Backup...
            </>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              Create Backup
            </>
          )}
        </button>
      </div>
    </div>
  );
};

const RestoreBackupTab: React.FC = () => {
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restored, setRestored] = useState(false);

  const backupManager = new BackupManager();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setBackupFile(file);
    }
  };

  const restoreBackup = async () => {
    if (!backupFile || !passphrase) {
      alert('Please select a backup file and enter the passphrase');
      return;
    }

    setIsRestoring(true);

    try {
      const backupText = await backupFile.text();
      const backup = JSON.parse(backupText);

      // Validate backup
      const validation = backupManager.validateBackup(backup);
      if (!validation.valid) {
        alert(`Invalid backup file: ${validation.errors.join(', ')}`);
        return;
      }

      await backupManager.restoreBackup(backup, passphrase);
      setRestored(true);
    } catch (error) {
      console.error('Backup restoration failed:', error);
      alert(`Backup restoration failed: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  if (restored) {
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <h3 className="font-medium text-green-900">Backup Restored Successfully</h3>
          </div>
          <p className="text-sm text-green-700">
            Your encryption keys have been restored. You can now access your encrypted message history.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-medium text-blue-900 mb-1">Next Steps</h4>
          <p className="text-sm text-blue-700">
            Refresh the page to ensure all components recognize the restored keys.
          </p>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Refresh Page
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Restore from Backup</h3>
        <p className="text-sm text-blue-700">
          Select your backup file and enter the passphrase to restore your encryption keys.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Backup File
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
              id="backup-file"
            />
            <label htmlFor="backup-file" className="cursor-pointer">
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">
                {backupFile ? backupFile.name : 'Click to select backup file'}
              </p>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Backup Passphrase
          </label>
          <div className="relative">
            <input
              type={showPassphrase ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter your backup passphrase"
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-yellow-900 mb-1">Warning</h4>
              <p className="text-sm text-yellow-700">
                Restoring a backup will replace your current encryption keys. Make sure you have 
                a backup of your current keys if needed.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={restoreBackup}
          disabled={isRestoring || !backupFile || !passphrase}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRestoring ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Restoring...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Restore Backup
            </>
          )}
        </button>
      </div>
    </div>
  );
};
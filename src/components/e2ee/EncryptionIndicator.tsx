'use client'

import React, { useState, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldX, Loader, Info } from 'lucide-react';
import { useE2EE } from '@/hooks/useE2EE';

interface EncryptionIndicatorProps {
  conversationId: string;
  className?: string;
  showLabel?: boolean;
}

export const EncryptionIndicator: React.FC<EncryptionIndicatorProps> = ({
  conversationId,
  className = '',
  showLabel = false
}) => {
  const { status, getEncryptionStatus, isInitializing } = useE2EE();
  const [encryptionState, setEncryptionState] = useState<{
    encrypted: boolean;
    reason?: string;
    loading: boolean;
  }>({
    encrypted: false,
    loading: true
  });

  useEffect(() => {
    const checkEncryption = async () => {
      if (isInitializing) return;
      
      setEncryptionState(prev => ({ ...prev, loading: true }));
      
      try {
        const state = await getEncryptionStatus(conversationId);
        setEncryptionState({
          encrypted: state.encrypted,
          reason: state.reason,
          loading: false
        });
      } catch (error) {
        console.error('Failed to check encryption status:', error);
        setEncryptionState({
          encrypted: false,
          reason: 'Failed to check encryption status',
          loading: false
        });
      }
    };

    checkEncryption();
  }, [conversationId, getEncryptionStatus, isInitializing]);

  const getIcon = () => {
    if (encryptionState.loading || isInitializing) {
      return <Loader className="w-4 h-4 animate-spin text-blue-500" />;
    }

    if (encryptionState.encrypted) {
      return <ShieldCheck className="w-4 h-4 text-green-500" />;
    }

    if (encryptionState.reason?.includes('device')) {
      return <ShieldAlert className="w-4 h-4 text-yellow-500" />;
    }

    return <ShieldX className="w-4 h-4 text-gray-400" />;
  };

  const getMessage = () => {
    if (encryptionState.loading || isInitializing) {
      return 'Checking encryption status...';
    }

    if (encryptionState.encrypted) {
      return 'Messages are end-to-end encrypted';
    }

    return encryptionState.reason || 'Messages are not encrypted';
  };

  const getStatusColor = () => {
    if (encryptionState.loading || isInitializing) {
      return 'text-blue-600 bg-blue-50 border-blue-200';
    }

    if (encryptionState.encrypted) {
      return 'text-green-600 bg-green-50 border-green-200';
    }

    if (encryptionState.reason?.includes('device')) {
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }

    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  if (!showLabel) {
    return (
      <div className={`inline-flex items-center ${className}`} title={getMessage()}>
        {getIcon()}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2 px-2 py-1 rounded text-sm border ${getStatusColor()} ${className}`}>
      {getIcon()}
      <span className="text-xs">{getMessage()}</span>
    </div>
  );
};

interface E2EESetupPromptProps {
  onSetup: () => void;
  onDismiss: () => void;
}

export const E2EESetupPrompt: React.FC<E2EESetupPromptProps> = ({
  onSetup,
  onDismiss
}) => {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="font-medium text-blue-900 mb-1">
            Enable End-to-End Encryption
          </h3>
          <p className="text-sm text-blue-700 mb-3">
            Secure your messages with end-to-end encryption. Only you and your 
            conversation partners will be able to read your messages.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onSetup}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Enable Encryption
            </button>
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-blue-600 text-sm rounded hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Not Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SafetyNumberModalProps {
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
}

export const SafetyNumberModal: React.FC<SafetyNumberModalProps> = ({
  userId,
  userName,
  isOpen,
  onClose
}) => {
  const { generateSafetyNumber } = useE2EE();
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && !safetyNumber) {
      const fetchSafetyNumber = async () => {
        setLoading(true);
        try {
          const number = await generateSafetyNumber(userId);
          setSafetyNumber(number);
        } catch (error) {
          console.error('Failed to generate safety number:', error);
        } finally {
          setLoading(false);
        }
      };

      fetchSafetyNumber();
    }
  }, [isOpen, userId, generateSafetyNumber, safetyNumber]);

  const copyToClipboard = async () => {
    if (safetyNumber) {
      await navigator.clipboard.writeText(safetyNumber);
      // You could add a toast notification here
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Safety Number
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ×
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Compare this safety number with {userName} to verify your conversation is secure.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : safetyNumber ? (
            <div className="bg-gray-100 dark:bg-gray-700 rounded p-4 font-mono text-lg text-center mb-4">
              {safetyNumber.match(/.{1,5}/g)?.join(' ')}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              Failed to generate safety number
            </div>
          )}
        </div>

        {safetyNumber && (
          <div className="flex gap-2">
            <button
              onClick={copyToClipboard}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Copy Number
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Close
            </button>
          </div>
        )}

        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              If the safety numbers match, your conversation is secure. If they don't match, 
              someone might be intercepting your messages.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
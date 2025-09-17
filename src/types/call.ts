// Type definitions for call system to ensure type safety

export type ParticipantState = 'ringing' | 'accepted' | 'connecting' | 'connected' | 'declined';

export type CallStatus = 
  | 'dialing' 
  | 'ringing' 
  | 'connecting' 
  | 'connected' 
  | 'disconnected' 
  | 'declined' 
  | 'ended';

export type ParticipantStatesMap = Record<string, ParticipantState>;

export interface CallParticipant {
  id: string
  name: string
  username: string
  avatar?: string | null
  isMuted: boolean
  isCameraOff: boolean
  isConnected: boolean
  participantStatus: 'ringing' | 'connecting' | 'connected'
}

export interface CallState {
  status: CallStatus
  duration: number
  connectedParticipants: number
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
}

export interface CallResponse {
  accepted: boolean
  participantId: string
  participantCount: number
  callStatus: string
  callId?: string
  allParticipants?: string[]
  participantStates?: ParticipantStatesMap
}

export interface CallStateUpdate {
  callId: string
  status: string
  participantCount: number
  connectedParticipants?: number
  participantStates?: ParticipantStatesMap
}
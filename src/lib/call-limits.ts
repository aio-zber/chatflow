export class CallLimitsManager {
  private static readonly MAX_PARTICIPANTS_BASIC = 2;  // 1-on-1 only initially
  private static readonly MAX_PARTICIPANTS_BETA = 4;   // Future beta testing
  private static readonly MAX_PARTICIPANTS_PREMIUM = 6; // Reduced for stability

  static validateCallParticipants(
    participants: string[], 
    isGroupCall: boolean,
    userTier: 'basic' | 'beta' | 'premium' = 'basic'
  ): { allowed: boolean; reason?: string; maxAllowed: number } {
    const limits = {
      basic: this.MAX_PARTICIPANTS_BASIC,
      beta: this.MAX_PARTICIPANTS_BETA,
      premium: this.MAX_PARTICIPANTS_PREMIUM
    };

    const maxAllowed = limits[userTier];
    const actualCount = participants.length;

    if (actualCount > maxAllowed) {
      return {
        allowed: false,
        reason: `Group calls limited to ${maxAllowed} participants for ${userTier} users`,
        maxAllowed
      };
    }

    // Special handling for group calls in basic tier
    if (userTier === 'basic' && isGroupCall && actualCount > 2) {
      return {
        allowed: false,
        reason: 'Group calls not supported in current version. Please upgrade for multi-participant calls.',
        maxAllowed
      };
    }

    return { allowed: true, maxAllowed };
  }

  static getRecommendedAction(participantCount: number): string {
    if (participantCount <= 2) return 'direct_call';
    if (participantCount <= 4) return 'small_group_beta';
    if (participantCount <= 8) return 'medium_group_premium';
    return 'enterprise_solution_required';
  }

  static getUpgradeMessage(participantCount: number): string {
    if (participantCount <= 4) {
      return 'Upgrade to Beta to enable group calls with up to 4 participants.';
    } else if (participantCount <= 6) {
      return 'Upgrade to Premium to enable group calls with up to 6 participants.';
    } else {
      return 'Group calls are optimized for up to 6 participants. Consider splitting into multiple calls for the best experience.';
    }
  }
}
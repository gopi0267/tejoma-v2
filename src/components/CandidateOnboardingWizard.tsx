import React, { useState } from 'react';
import CandidateOnboardingChoice, { OnboardingPath } from './CandidateOnboardingChoice.js';
import CandidateOnboardingManual from './CandidateOnboardingManual.js';
import CandidateOnboardingAIResume from './CandidateOnboardingAIResume.js';
import { useCandidateAuth } from '../context/CandidateAuthContext.js';

// Shown exactly once, right after a candidate's first successful login/registration (gated by
// candidate_accounts.onboarding_completed_at being NULL - see CandidateApp.tsx, unchanged).
// Replaces the old fixed 6-step Education->Skills->Experience->Resume->Summary sequence with an
// explicit up-front choice between two complete, self-contained paths - the candidate picks how
// they want to build their profile, then either fills it in themselves or has AI draft it from
// their resume for review. Both paths converge on the same exit: PUT
// /candidate-auth/complete-onboarding (the exact same endpoint the old wizard's "Skip"/summary
// step already used), then onComplete().
type Stage = 'choice' | OnboardingPath;

export default function CandidateOnboardingWizard({ candidateName, onComplete }: { candidateName: string; onComplete: () => void }) {
  const { candidate } = useCandidateAuth();
  const [stage, setStage] = useState<Stage>('choice');

  if (stage === 'manual') {
    return (
      <CandidateOnboardingManual
        candidateName={candidateName}
        onBack={() => setStage('choice')}
        onComplete={onComplete}
      />
    );
  }

  if (stage === 'ai-resume') {
    return (
      <CandidateOnboardingAIResume
        candidateName={candidateName}
        accountEmail={candidate?.email || ''}
        accountPhone={candidate?.phone || ''}
        onBack={() => setStage('choice')}
        onComplete={onComplete}
      />
    );
  }

  return <CandidateOnboardingChoice candidateName={candidateName} onChoose={setStage} />;
}

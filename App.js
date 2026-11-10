import React, { useEffect, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Login from './src/screens/Login';
import Voice from './src/screens/Voice';
import Review from './src/screens/Review';
import Notes from './src/screens/Notes';
import { sendHandoff } from './src/handoff';

export default function App() {
  const [screen, setScreen] = useState('login'); // login(A01) | voice(A02) | review(A03) | notes(A04)
  const [user, setUser] = useState(null);
  const [draft, setDraft] = useState(null);   // AI 가 정리한 초안
  const [report, setReport] = useState(null); // 사용자가 검수/수정한 보고서 (앱 메모리에만 존재, 저장 안 함)

  // 이전 화면으로 (왼쪽 상단 ← 버튼, 안드로이드 하드웨어 뒤로가기 공용)
  function goBack() {
    if (screen === 'voice') { setDraft(null); setReport(null); setScreen('login'); return true; }
    if (screen === 'review') { setScreen('voice'); return true; }
    if (screen === 'notes') { setScreen('review'); return true; }
    return false; // 로그인 화면에서는 기본 동작(앱 종료)
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [screen]);

  // A04 '병원 매칭 및 호출' → 다음 담당자에게 { ktas, requiredFacilities } 만 전달
  function handleHandoff(payload) {
    const sent = sendHandoff(payload); // src/handoff.js 참고
    // TODO(다음 담당자): 여기서 setScreen('home') 등으로 A05 화면 이동을 이어서 개발하세요.
    Alert.alert('다음 단계로 전달됨', `KTAS ${sent.ktas}등급\n필수 시설: ${sent.requiredFacilities.join(', ') || '없음'}`);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {screen === 'login' && (
        <Login onLogin={(u) => { setUser(u); setScreen('voice'); }} />
      )}
      {screen === 'voice' && (
        <Voice
          teamName={user?.teamName}
          onBack={goBack}
          onDone={(text, d) => { setDraft(d); setReport(null); setScreen('review'); }}
        />
      )}
      {screen === 'review' && (
        <Review draft={draft} initial={report} onBack={goBack} onNext={(r) => { setReport(r); setScreen('notes'); }} />
      )}
      {screen === 'notes' && (
        <Notes
          report={report}
          onBack={(r) => { setReport(r); setScreen('review'); }}
          onHandoff={handleHandoff}
        />
      )}
    </SafeAreaProvider>
  );
}

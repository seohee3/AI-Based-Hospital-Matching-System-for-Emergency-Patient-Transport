import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Login from './src/screens/Login';
import Voice from './src/screens/Voice';
import Review from './src/screens/Review';
import Notes from './src/screens/Notes';
import CallProgress from './src/screens/CallProgress';
import History from './src/screens/History';
import { prepareCall, loadCreatedCall, sendHospitalResponse, cancelCall, retryCall } from './src/callApi';
import { sendHandoff } from './src/handoff';
import * as Location from 'expo-location';

export default function App() {
  const [screen, setScreen] = useState('login');
  const [call, setCall] = useState(null);
  const currentCall = useRef(null);
  const originalCallCount = useRef(0);
  const declineAll = useRef(false);
  const operation = useRef(null);
  const [busyAction, setBusyAction] = useState(null);
  const [syncError, setSyncError] = useState(false);
  const [historyFrom, setHistoryFrom] = useState('voice');
  const [matching, setMatching] = useState(false);
  const activeMatch = useRef(null);
  const pendingSubmission = useRef(null);
  const [openingCall, setOpeningCall] = useState(false);
  const [user, setUser] = useState(null);
  const [draft, setDraft] = useState(null);   // AI 가 정리한 초안
  const [report, setReport] = useState(null); // 사용자가 검수/수정한 보고서 (앱 메모리에만 존재, 저장 안 함)

  // The single-device demo plays the hospital side while A06 displays server snapshots.
  useEffect(() => {
    if (screen !== 'callProgress' || !call || call.outcome || busyAction) return;
    const index = call.hospitals.findIndex(h => h.status === 'pending');
    if (index < 0) return;
    let attempt;
    const winner = Math.min(1, call.hospitals.length - 1);
    const accept = (call.retryOf || !declineAll.current) && index === winner;
    let stopped = false;
    let timeout;
    let timer;
    async function simulate() {
      if (operation.current || currentCall.current !== call || stopped) return;
      attempt = new AbortController();
      timeout = setTimeout(() => attempt.abort(), 10000);
      try {
        const next = await sendHospitalResponse(call.id, call.hospitals[index].hpid,
          accept ? 'accepted' : 'declined', attempt.signal);
        if (stopped || operation.current || currentCall.current !== call) return;
        setSyncError(false);
        currentCall.current = next;
        setCall(next);
      } catch {
        if (stopped || operation.current || currentCall.current !== call) return;
        setSyncError(true);
        timer = setTimeout(simulate, 4000);
      } finally {
        clearTimeout(timeout);
      }
    }
    timer = setTimeout(simulate, 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      attempt?.abort();
    };
  }, [call, screen, busyAction]);

  async function cancel(id) {
    if (operation.current || currentCall.current?.id !== id || currentCall.current.outcome) return;
    operation.current = 'cancel';
    setBusyAction('cancel');
    try {
      const next = await cancelCall(id);
      currentCall.current = next;
      setCall(next);
      setSyncError(false);
    } catch (error) {
      Alert.alert('취소 결과 확인 실패', error.message + '\n다시 시도해 주세요.');
    } finally {
      operation.current = null;
      setBusyAction(null);
    }
  }

  function confirmCancel() {
    const active = currentCall.current;
    if (!active || active.outcome || operation.current) return;
    Alert.alert('호출을 취소할까요?', '대기 중인 병원 요청이 종료되고 취소 기록이 남습니다.', [
      { text: '계속 대기', style: 'cancel' },
      { text: '호출 취소', style: 'destructive', onPress: () => cancel(active.id) },
    ]);
  }

  function openHistory() {
    if (operation.current) return;
    setHistoryFrom(screen);
    setScreen('history');
  }

  async function requestAgain(previous) {
    if (currentCall.current !== previous || previous.outcome !== 'declined' || operation.current) return;
    operation.current = 'retry';
    setBusyAction('retry');
    try {
      const next = await retryCall(previous.id);
      currentCall.current = next;
      setCall(next);
    } catch (error) {
      Alert.alert('재요청 결과 확인 실패', error.message + '\n같은 호출에서 다시 시도해 주세요.');
    } finally {
      operation.current = null;
      setBusyAction(null);
    }
  }

  function goBack() {
    if (screen === 'voice') { setDraft(null); setReport(null); setScreen('login'); return true; }
    if (screen === 'review') { setScreen('voice'); return true; }
    if (screen === 'notes') {
      activeMatch.current?.abort();
      activeMatch.current = null;
      // Keep the submission: aborting the phone request cannot undo a committed POST.
      setOpeningCall(false);
      setMatching(false);
      setScreen('review');
      return true;
    }
    if (screen === 'history') { setScreen(historyFrom); return true; }
    if (screen === 'callProgress') {
      if (operation.current) return true;
      if (!currentCall.current?.outcome) { confirmCancel(); return true; }
      currentCall.current = null;
      setCall(null);
      setScreen('notes');
      return true;
    }
    return false; // 로그인 화면에서는 기본 동작(앱 종료)
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [screen, historyFrom]);

  async function handleHandoff(finalReport) {
    if (activeMatch.current) return;
    const request = new AbortController();
    activeMatch.current = request;
    setMatching(true);
    setReport(finalReport);

    async function openSubmission(submission) {
      setOpeningCall(true);
      try {
        const next = await loadCreatedCall(submission, request.signal);
        if (request.signal.aborted) return;
        originalCallCount.current += 1;
        declineAll.current = originalCallCount.current % 2 === 0;
        setSyncError(false);
        pendingSubmission.current = null;
        currentCall.current = next;
        setCall(next);
        setScreen('callProgress');
      } catch (error) {
        if (request.signal.aborted) return;
        if (error.creationRejected) pendingSubmission.current = null;
        Alert.alert('C 서버 연결', error.message + '\n다시 시도할 수 있습니다.');
      }
    }

    try {
      const pending = pendingSubmission.current;
      if (pending) {
        await openSubmission(pending);
        return;
      }
      const sent = sendHandoff(finalReport);
      console.log("📍 구급차 현재 위치 파악 중...");

      // 1. 위치 권한 요청
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (request.signal.aborted) return;
      if (status !== 'granted') {
        Alert.alert('권한 오류', '위치 정보를 허용해야 가까운 병원을 찾을 수 있습니다.');
        return;
      }

      // 2. 버튼 누른 순간의 실시간 GPS 좌표 추출
      let location = await Location.getCurrentPositionAsync({});
      if (request.signal.aborted) return;
      const finalPayload = {
        ...sent,
        lat: location.coords.latitude,
        lon: location.coords.longitude
      };

      console.log("🚀 B파트로 전송할 최종 데이터:", finalPayload);

      // 3. B파트 서버로 전송 (본인 컴퓨터의 IPv4 주소로 변경 필수)
      const BACKEND_URL = process.env.EXPO_PUBLIC_MATCH_URL || 'http://172.31.74.154:3000/api/match';
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
        signal: request.signal,
      });

      

      const data = await response.json();

      if (request.signal.aborted) return;
      if (!response.ok || !data.success || !Array.isArray(data.hospitals)) {
        Alert.alert('조회 실패', '후보 병원을 조회하지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      if (!data.hospitals.length) {
        Alert.alert('후보 병원 없음', '조건에 맞는 후보 병원이 없습니다.');
        return;
      }
      const submission = prepareCall(finalReport, data);
      pendingSubmission.current = submission;
      await openSubmission(submission);
    } catch (error) {
      if (request.signal.aborted) return;
      console.error("B파트 서버 통신 실패:", error);
      Alert.alert("통신 오류", "병원 매칭 서버에 연결할 수 없습니다.");
    } finally {
      if (activeMatch.current === request) {
        activeMatch.current = null;
        setMatching(false);
        setOpeningCall(false);
      }
    }
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
          onHistory={openHistory}
          onBack={goBack}
          onDone={(text, d) => { pendingSubmission.current = null; setDraft(d); setReport(null); setScreen('review'); }}
        />
      )}
      {screen === 'review' && (
        <Review draft={draft} initial={report} onBack={goBack} onNext={(r) => { setReport(r); setScreen('notes'); }} />
      )}
      {screen === 'notes' && (
        <Notes
          report={pendingSubmission.current?.body.report ?? report}
          resuming={!!pendingSubmission.current}
          matching={matching}
          openingCall={openingCall}
          onBack={(r) => { setReport(r); goBack(); }}
          onHandoff={handleHandoff}
        />
      )}
      {screen === 'callProgress' && (
        <CallProgress call={call} busyAction={busyAction} syncError={syncError} onBack={goBack}
          onCancel={confirmCancel} onHistory={openHistory} onRequestAgain={() => requestAgain(call)} />
      )}
      {screen === 'history' && <History onBack={goBack} />}
    </SafeAreaProvider>
  );
}

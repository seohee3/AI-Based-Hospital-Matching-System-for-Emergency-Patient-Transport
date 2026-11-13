import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, Alert } from 'react-native';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { Screen, Header, Box, Btn } from '../ui';
import { C } from '../theme';
import { transcribe, makeReport } from '../api';

// A02 음성 브리핑: 녹음 → (whisper-large-v3-turbo) 텍스트 → (openai/gpt-oss-120b) 보고서 항목
export default function Voice({ teamName, onDone, onBack }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing | drafting
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true); // 화면을 떠난 뒤 늦게 도착한 결과를 무시하기 위함
  useEffect(() => () => { alive.current = false; }, []);

  async function start() {
    try {
      setError('');
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('마이크 권한 필요', '설정에서 마이크 권한을 허용해 주세요.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTranscript('');
      setPhase('recording');
    } catch (e) {
      setError(`녹음을 시작하지 못했습니다: ${e.message}`);
    }
  }

  async function stop() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('녹음 파일을 찾을 수 없습니다.');

      setPhase('transcribing');
      const text = await transcribe(uri);
      if (!alive.current) return;
      if (!text) throw new Error('음성이 인식되지 않았습니다. 다시 녹음해 주세요.');
      setTranscript(text);

      setPhase('drafting');
      const draft = await makeReport(text);
      if (!alive.current) return;
      setPhase('idle');
      onDone(text, draft);
    } catch (e) {
      if (!alive.current) return;
      setPhase('idle');
      setError(e.message);
    }
  }

  async function back() {
    try { if (phase === 'recording') await recorder.stop(); } catch (e) { /* ignore */ }
    onBack();
  }

  const recording = phase === 'recording';
  const working = phase === 'transcribing' || phase === 'drafting';
  const status =
    phase === 'recording' ? '녹음 중… 말씀이 끝나면 아래 버튼을 누르세요'
    : phase === 'transcribing' ? '음성을 텍스트로 변환하는 중…'
    : phase === 'drafting' ? 'AI가 보고서 항목을 정리하는 중…'
    : '아래 마이크를 눌러 브리핑을 시작하세요';

  return (
    <Screen>
      <Header title="AI 현장 브리핑" onBack={back} />
      <Text style={{ color: C.mut, fontSize: 12 }}>{teamName}</Text>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={recording || working}
        onPress={start}
        style={{
          width: 110, height: 110, borderRadius: 55, backgroundColor: C.red, alignSelf: 'center', marginVertical: 18,
          alignItems: 'center', justifyContent: 'center', opacity: working ? 0.5 : 1,
          borderWidth: recording ? 6 : 0, borderColor: '#F7A6AF',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 38 }}>{recording ? '●' : '🎙'}</Text>
      </TouchableOpacity>

      <Text style={{ textAlign: 'center', color: C.mut, fontSize: 13 }}>{status}</Text>

      <Box label="변환된 텍스트">
        <Text style={{ fontSize: 14, color: C.ink, minHeight: 80 }}>
          {transcript ? `"${transcript}"` : ' '}
        </Text>
      </Box>

      {error ? <Text style={{ color: C.red, fontSize: 13 }}>{error}</Text> : null}

      <Btn title="■ 녹음 종료" color={C.navy} disabled={!recording} loading={working} onPress={stop} />
    </Screen>
  );
}

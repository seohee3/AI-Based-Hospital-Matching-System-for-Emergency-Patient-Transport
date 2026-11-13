import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Box, Btn, Header, Screen, s } from '../ui';
import ReportSummary from '../ReportSummary';
import { statusText } from '../callResponses';
import { C } from '../theme';

function ActiveCall({ call, onCancel, busyAction, syncError }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - call.startedAt) / 1000)) || 0;
  const clock = [Math.floor(elapsed / 60), elapsed % 60].map(n => String(n).padStart(2, '0')).join(':');
  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={s.h2}>{call.hospitals.length}개 병원 동시 호출</Text>
        <Text style={styles.time}>{clock}</Text>
      </View>
      {call.hospitals.map(h => {
        const declined = h.status === 'declined';
        return (
          <View key={h.hpid} style={styles.card}>
            <View style={styles.info}>
              <Text style={styles.name}>{h.dutyName}</Text>
              <Text style={styles.meta}>{h.distanceKm == null ? '거리 미확인' : h.distanceKm + 'km'} · {h.etaMinutes == null ? 'ETA 미확인' : 'ETA ' + h.etaMinutes + '분'}</Text>
            </View>
            <Text style={[styles.badge, declined && styles.declined]}>{declined ? '수용 불가' : '응답 대기'}</Text>
          </View>
        );
      })}
      {syncError && <Text style={styles.meta}>병원 응답을 확인하는 중입니다. 자동으로 다시 연결합니다.</Text>}
      <Btn color={C.gray} title={busyAction === 'cancel' ? '취소 중…' : '호출 취소'} disabled={!!busyAction} onPress={onCancel} />
    </Screen>
  );
}

export default function CallProgress({ call, busyAction, syncError, onBack, onCancel, onHistory, onRequestAgain }) {
  const { report, hospitals, outcome } = call;
  const confirmed = hospitals.find(h => h.status === 'accepted');
  const responses = hospitals.filter(h => h.status === 'accepted' || h.status === 'declined').length;

  if (!outcome) return <ActiveCall key={call.id} call={call} onCancel={onCancel} busyAction={busyAction} syncError={syncError} />;

  return (
    <Screen>
      <Header title={confirmed ? '이송 병원 확정' : '호출 종료'} onBack={onBack} />
      {confirmed && (
        <Box label="수용 가능 · 확정된 이송 병원">
          <Text style={s.h2}>{confirmed.dutyName}</Text>
          <Text style={s.value}>{confirmed.dutyAddr || '주소 미확인'}</Text>
          <Text style={s.value}>{confirmed.dutyTel3 || '전화번호 미확인'} · {confirmed.etaMinutes == null ? '예상 시간 미확인' : `예상 ${confirmed.etaMinutes}분`}</Text>
        </Box>
      )}
      {outcome === 'declined' && <Text style={s.h2}>모든 후보 병원이 거절했습니다.</Text>}
      {outcome === 'declined' && (
        <Btn title={busyAction === 'retry' ? '재요청 중…' : '기존 후보 병원에 다시 요청'} disabled={!!busyAction} onPress={onRequestAgain} />
      )}
      {outcome === 'cancelled' && <Text style={s.h2}>호출을 취소했습니다.</Text>}
      <Text style={s.value}>
        {call.retryOf ? '재요청 · ' : ''}후보 {hospitals.length}곳 중 {responses}곳 응답 · 탐색 반경 {call.appliedRadiusKm}km
      </Text>
      {hospitals.map((hospital, index) => (
        <Box key={hospital.hpid} label={`${index + 1}순위 · ${statusText[hospital.status]}`}>
          <Text style={s.h2}>{hospital.dutyName}</Text>
          <Text style={s.value}>
            직선 {hospital.distanceKm}km · {hospital.etaMinutes == null
              ? '예상 시간 미확인'
              : `예상 ${hospital.etaMinutes}분`}
          </Text>
        </Box>
      ))}
      <Btn title="지난 이송 기록" disabled={!!busyAction} onPress={onHistory} />
      <ReportSummary report={report} showNotes />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 14, fontWeight: '700', color: C.mut, fontVariant: ['tabular-nums'] },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.gray },
  info: { flex: 1, gap: 4 },
  name: { color: C.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: C.mut, fontSize: 13 },
  badge: { overflow: 'hidden', borderRadius: 12, backgroundColor: '#FFF1C7', color: '#815500', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4 },
  declined: { backgroundColor: C.surf, color: C.mut },
});

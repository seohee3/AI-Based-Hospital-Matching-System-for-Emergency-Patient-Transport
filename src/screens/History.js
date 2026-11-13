import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Btn, Header, s } from '../ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchCallDetail, fetchHistory } from '../callApi';
import { outcomeText, statusText } from '../callResponses';
import { C, KTAS_COLORS } from '../theme';

const tagColors = ['#4468AE', '#307A75', '#795998', '#976037'];

function groupByOriginalCall(records) {
  const parents = new Map(records.map(record => [record.id, record.retryOf]));
  const roots = new Map();
  const groups = new Map();
  for (const record of records) {
    let id = record.id;
    const path = [];
    while (parents.get(id) && !roots.has(id)) {
      path.push(id);
      id = parents.get(id);
    }
    const root = roots.get(id) ?? id;
    for (const step of path) roots.set(step, root);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  }
  return [...groups.values()];
}

const tones = {
  confirmed: { ink: '#06754A', tint: '#DCF8E7', panel: '#EFFBF3', border: '#ACF0C4' },
  declined: { ink: '#B52B20', tint: '#FDE5E2', panel: '#FFF5F4', border: '#F6D1CD' },
  cancelled: { ink: '#526078', tint: '#E5EAF1', panel: '#F5F7FA', border: '#D8DFE9' },
};

function clock(value) {
  if (!value) return '–';
  return new Date(value).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

function Times({ record, start }) {
  return <View style={styles.times}>
    <Text style={styles.meta}>호출 시작 {clock(record.startedAt || start)}</Text>
    <Text style={styles.meta}>호출 종료 {clock(record.finishedAt)}</Text>
  </View>;
}

function Toggle({ title, open, onPress, full }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}
    style={[styles.button, !full && styles.inlineButton]}>
    <Text style={styles.buttonText}>{title}</Text>
  </Pressable>;
}

function Report({ report }) {
  const fields = [
    ['환자', report.patient], ['주증상', report.symptoms], ['혈압', report.bp], ['의식', report.consciousness],
    ['KTAS', report.ktas && report.ktas + '등급'], ['필수 시설', report.requiredFacilities?.join(', ')],
    ['특이사항', report.notes || '없음'],
  ];
  return <View style={styles.report}>
    <Text style={styles.title}>환자 보고서</Text>
    <View style={styles.grid}>{fields.map(([label, value]) => <View key={label} style={label === '특이사항' ? styles.wide : styles.cell}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={[styles.value, label === 'KTAS' && report.ktas && styles.badge,
        label === 'KTAS' && report.ktas && { backgroundColor: (KTAS_COLORS[report.ktas - 1] || C.ink) + '30' }]}>
        {value || '–'}
      </Text>
    </View>)}</View>
  </View>;
}

function HistoryCard({ group, index, open, onToggle }) {
  const latest = group[0];
  const [selected, setSelected] = useState(latest.id);
  const [details, setDetails] = useState({});
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const detail = details[selected];
  useEffect(() => {
    if (!open || !selected || detail) return;
    const request = new AbortController();
    setError(false);
    fetchCallDetail(selected, request.signal).then(result => {
      if (!request.signal.aborted) setDetails(prev => ({ ...prev, [selected]: result }));
    }).catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [open, selected, detail, attempt]);
  const tone = tones[latest.outcome] || tones.cancelled;
  const date = new Date(latest.finishedAt);
  const dateLabel = [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('.');
  return <View style={styles.card}>
    <View style={styles.heading}>
      <View style={[styles.dot, {backgroundColor:tagColors[index % tagColors.length]}]} />
      <Text style={[styles.title, {flex:1}]}>이송 건 {index + 1}</Text><Text style={styles.meta}>{dateLabel}</Text>
    </View>
    <View style={[styles.summary, {backgroundColor:tone.panel, borderColor:tone.border}]}>
      <Text style={[styles.badge, {backgroundColor:tone.tint,color:tone.ink}]}>{outcomeText[latest.outcome]}</Text>
      {latest.winner ? <Text style={styles.winner}>{latest.winner}</Text> : null}
      <Times record={latest} start={details[latest.id]?.startedAt} />
    </View>
    {open && <>
      <View style={styles.timeline}>{[...group].reverse().map(record => {
        const active = record.id === selected;
        const color = tones[record.outcome] || tones.cancelled;
        return <View key={record.id} style={styles.step}>
          <View style={[styles.marker,{backgroundColor:color.ink}]} />
          <View style={styles.heading}><Text style={styles.title}>{record.retryOf ? '재요청' : '최초 호출'}</Text>
            <Text style={[styles.badge,{color:color.ink,backgroundColor:color.tint}]}>{record.outcome === 'confirmed' ? '병원 확정' : outcomeText[record.outcome]}</Text>
          </View>
          <Times record={record} start={details[record.id]?.startedAt} />
          {active ? detail ? detail.hospitals.map(h => <View key={h.hpid} style={[styles.hospital,h.status === 'accepted' && {backgroundColor:tones.confirmed.tint}]}>
            <Text style={[styles.rank,h.status === 'accepted' && {backgroundColor:tones.confirmed.ink,color:'white'}]}>{h.rank}</Text>
            <View style={{flex:1}}><Text style={styles.value}>{h.dutyName}</Text>
              <Text style={[styles.meta,h.status === 'accepted' && {color:tones.confirmed.ink}]}>{statusText[h.status]}{h.respondedAt ? ' · '+clock(h.respondedAt) : ''}</Text></View>
          </View>) : error ? <Toggle title="상세 다시 조회" open={false} onPress={() => setAttempt(n => n+1)} /> : <Text style={styles.meta}>상세 불러오는 중…</Text>
            : <Toggle title={'후보 '+record.candidateCount+'곳 상세 보기'} open={false} onPress={() => {setError(false);setSelected(record.id);}} />}
        </View>;
      })}</View>
      {detail && <Report report={detail.report} />}
    </>}
    <Toggle full open={open} title={open ? '상세 접기  ⌃' : '상세 보기  ⌄'} onPress={onToggle} />
  </View>;
}

export default function History({ onBack }) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const groups = useMemo(() => groupByOriginalCall(records), [records]);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError(false);
    fetchHistory(cursor, request.signal).then(page => {
      if (request.signal.aborted) return;
      setRecords(previous => cursor ? [...previous, ...page.records] : page.records);
      if (!cursor) setExpanded(page.records[0]?.id ?? null);
      setNextCursor(page.nextCursor);
    }).catch(() => { if (!request.signal.aborted) setError(true); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [cursor, attempt]);
  return (
    <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
      <Header title="지난 이송 기록" onBack={onBack} />
      {!loading && !error && records.length === 0 && <Text style={s.value}>아직 종료된 호출이 없습니다.</Text>}
      {groups.map((group,index) => <HistoryCard key={group[0].id} group={group} index={index}
        open={expanded === group[0].id} onToggle={() => setExpanded(expanded === group[0].id ? null : group[0].id)} />)}
      {loading && <Text style={s.value}>기록 불러오는 중…</Text>}
      {error && <Btn title="기록 조회 실패 · 다시 조회" onPress={() => setAttempt(n => n + 1)} />}
      {!loading && !error && nextCursor && <Btn title="이전 기록 더 보기" onPress={() => setCursor(nextCursor)} />}
    </ScrollView></SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex:1, backgroundColor:'#EDF1F7'},
  content: {padding:16, gap:16},
  card: {backgroundColor:'#FFF', borderRadius:20, padding:20, gap:18},
  heading: {flexDirection:'row', alignItems:'center', gap:8},
  dot: {width:10, height:10, borderRadius:5},
  title: {fontSize:15, fontWeight:'700', color:C.ink},
  summary: {padding:15, gap:8, borderWidth:1, borderRadius:14},
  badge: {alignSelf:'flex-start', fontSize:12, fontWeight:'700', paddingHorizontal:9, paddingVertical:4, borderRadius:12, overflow:'hidden'},
  winner: {color:C.ink, fontWeight:'800', fontSize:19},
  times: {gap:3},
  meta: {color:'#58667C', fontSize:12, lineHeight:18},
  timeline: {borderLeftWidth:2, borderLeftColor:'#D9E1EF', marginLeft:7, gap:18},
  step: {paddingLeft:17, gap:6},
  marker: {position:'absolute', left:-9, top:2, width:16, height:16, borderRadius:8, borderWidth:2, borderColor:'white'},
  hospital: {flexDirection:'row', alignItems:'flex-start', gap:10, padding:12, backgroundColor:'#F4F6FA', borderRadius:12},
  rank: {color:C.ink, backgroundColor:'#E2E8F1', borderRadius:13, overflow:'hidden', minWidth:26, lineHeight:26, textAlign:'center', fontWeight:'700'},
  report: {borderTopWidth:1, borderTopColor:'#E6EAF1', paddingTop:18, gap:14},
  grid: {flexDirection:'row', flexWrap:'wrap', rowGap:14},
  cell: {width:'50%', paddingRight:8, gap:2}, wide: {width:'100%', gap:2},
  value: {color:C.ink, fontSize:14, fontWeight:'600'},
  button: {borderColor:'#CFD9EB', borderWidth:1, minHeight:44, borderRadius:10, alignItems:'center', justifyContent:'center', paddingHorizontal:14},
  inlineButton: {alignSelf:'flex-start', marginTop:3},
  buttonText: {color:'#255BD5', fontWeight:'700', fontSize:14},
});

#!/usr/bin/env python3
"""
03_patient_timeline_extraction.py
환자별 임상 기록 타임라인 추출 및 개별 JSON 저장

실행: python 03_patient_timeline_extraction.py
"""

import duckdb
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
from pathlib import Path

# ============================================
# 설정
# ============================================

DB_PATH = '../mimic_total.duckdb'
COHORT_CSV = '../outputs/cohort_patients_v4.csv'
OUTPUT_DIR = '../outputs/patient_timelines'

# 출력 디렉토리 생성
Path(OUTPUT_DIR).mkdir(exist_ok=True, parents=True)

print("=" * 70)
print("환자별 임상 기록 타임라인 추출")
print("=" * 70)


# ============================================
# Step 1: 코호트 로드 및 DB 연결
# ============================================

print("\n[Step 1] 코호트 로드 및 DB 연결...")

cohort = pd.read_csv(COHORT_CSV)
cohort['hadm_id'] = cohort['hadm_id'].astype(int)
cohort['subject_id'] = cohort['subject_id'].astype(int)

# subject_id 기준으로 정리
subject_ids = cohort['subject_id'].unique().tolist()
hadm_ids = cohort['hadm_id'].unique().tolist()
hadm_id_str = ','.join(map(str, hadm_ids))

print(f"  코호트 환자 수: {len(subject_ids)}명")
print(f"  코호트 입원 수: {len(hadm_ids)}건")

conn = duckdb.connect(DB_PATH, read_only=True)
print(f"  DuckDB 연결 완료")

# 중복 감염 타입 합치기 (hadm_id 기준)
infection_types_by_hadm = cohort.groupby('hadm_id').agg({
    'subcategory': lambda x: list(x.unique()),
    'infection_timing': lambda x: list(x.unique())
}).reset_index()
infection_types_by_hadm.columns = ['hadm_id', 'infection_types', 'infection_timings']

# hadm_id 기준 중복 제거 (첫 번째 행 유지)
cohort_dedup = cohort.drop_duplicates(subset=['hadm_id'], keep='first').copy()

# 감염 타입 리스트 병합
cohort_dedup = cohort_dedup.merge(infection_types_by_hadm, on='hadm_id', how='left')

print(f"  중복 제거 후 입원 수: {len(cohort_dedup)}건")
print(f"  다중 감염 케이스: {(cohort_dedup['infection_types'].apply(len) > 1).sum()}건")

# 이후 cohort 대신 cohort_dedup 사용
cohort = cohort_dedup


# ============================================
# Step 2: 전체 데이터 추출
# ============================================

print("\n[Step 2] 전체 임상 데이터 추출...")

# Lab
print("  - Lab 추출 중...")
lab_query = f"""
SELECT 
    le.subject_id,
    le.hadm_id,
    le.charttime,
    le.itemid,
    di.label AS lab_name,
    di.category,
    le.value,
    le.valuenum,
    le.valueuom,
    le.flag
FROM labevents le
LEFT JOIN d_labitems di ON le.itemid = di.itemid
WHERE le.hadm_id IN ({hadm_id_str})
ORDER BY le.hadm_id, le.charttime
"""
lab_df = conn.execute(lab_query).df()
lab_df['hadm_id'] = lab_df['hadm_id'].astype(int)
lab_df['subject_id'] = lab_df['subject_id'].astype(int)
print(f"    Lab: {len(lab_df):,}건")

# Vitals
print("  - Vitals 추출 중...")
vital_items = [220045, 220050, 220051, 220052, 220179, 220180, 220181, 
               220210, 223761, 223762, 220277]
vital_item_str = ','.join(map(str, vital_items))

vitals_query = f"""
SELECT 
    ce.subject_id,
    ce.hadm_id,
    ce.charttime,
    ce.itemid,
    di.label AS vital_name,
    ce.value,
    ce.valuenum,
    ce.valueuom
FROM chartevents ce
LEFT JOIN d_items di ON ce.itemid = di.itemid
WHERE ce.hadm_id IN ({hadm_id_str})
  AND ce.itemid IN ({vital_item_str})
ORDER BY ce.hadm_id, ce.charttime
"""
vitals_df = conn.execute(vitals_query).df()
vitals_df['hadm_id'] = vitals_df['hadm_id'].astype(int)
vitals_df['subject_id'] = vitals_df['subject_id'].astype(int)
print(f"    Vitals: {len(vitals_df):,}건")

# Culture
print("  - Culture 추출 중...")
culture_query = f"""
SELECT 
    me.subject_id,
    me.hadm_id,
    me.chartdate,
    me.charttime,
    me.spec_type_desc,
    me.org_name,
    me.isolate_num,
    me.ab_name,
    me.dilution_text,
    me.dilution_comparison,
    me.dilution_value,
    me.interpretation
FROM microbiologyevents me
WHERE me.hadm_id IN ({hadm_id_str})
ORDER BY me.hadm_id, me.chartdate, me.charttime
"""
culture_df = conn.execute(culture_query).df()
culture_df['hadm_id'] = culture_df['hadm_id'].astype(int)
culture_df['subject_id'] = culture_df['subject_id'].astype(int)
print(f"    Culture: {len(culture_df):,}건")

# Medications
print("  - Medications 추출 중...")
meds_query = f"""
SELECT 
    subject_id,
    hadm_id,
    starttime,
    stoptime,
    medication,
    route,
    frequency,
    doses_per_24_hrs,
    status
FROM pharmacy
WHERE hadm_id IN ({hadm_id_str})
ORDER BY hadm_id, starttime
"""
meds_df = conn.execute(meds_query).df()
meds_df['hadm_id'] = meds_df['hadm_id'].astype(int)
meds_df['subject_id'] = meds_df['subject_id'].astype(int)
print(f"    Medications: {len(meds_df):,}건")

# Diagnosis
print("  - Diagnosis 추출 중...")
diagnosis_query = f"""
SELECT 
    di.subject_id,
    di.hadm_id,
    di.seq_num,
    di.icd_code,
    di.icd_version,
    icd.long_title
FROM diagnoses_icd di
LEFT JOIN d_icd_diagnoses icd 
    ON di.icd_code = icd.icd_code AND di.icd_version = icd.icd_version
WHERE di.hadm_id IN ({hadm_id_str})
ORDER BY di.hadm_id, di.seq_num
"""
diagnosis_df = conn.execute(diagnosis_query).df()
diagnosis_df['hadm_id'] = diagnosis_df['hadm_id'].astype(int)
diagnosis_df['subject_id'] = diagnosis_df['subject_id'].astype(int)
print(f"    Diagnosis: {len(diagnosis_df):,}건")

print("  ✅ 데이터 추출 완료")


# ============================================
# Step 3: 타임라인 생성 함수
# ============================================

print("\n[Step 3] 타임라인 생성 함수 정의...")

def safe_value(val):
    """NaN을 None으로 변환"""
    if pd.isna(val):
        return None
    if isinstance(val, (np.integer, np.floating)):
        return float(val) if np.isfinite(val) else None
    return val

def create_timeline_events(hadm_id):
    """특정 입원의 모든 이벤트를 시간순 타임라인으로 생성"""
    events = []
    
    # Lab events
    hadm_labs = lab_df[lab_df['hadm_id'] == hadm_id]
    for _, row in hadm_labs.iterrows():
        if pd.notna(row['charttime']):
            events.append({
                'datetime': str(row['charttime']),
                'type': 'lab',
                'name': safe_value(row['lab_name']),
                'category': safe_value(row['category']),
                'value': safe_value(row['value']),
                'valuenum': safe_value(row['valuenum']),
                'unit': safe_value(row['valueuom']),
                'flag': safe_value(row['flag'])
            })
    
    # Vital events
    hadm_vitals = vitals_df[vitals_df['hadm_id'] == hadm_id]
    for _, row in hadm_vitals.iterrows():
        if pd.notna(row['charttime']):
            events.append({
                'datetime': str(row['charttime']),
                'type': 'vital',
                'name': safe_value(row['vital_name']),
                'value': safe_value(row['value']),
                'valuenum': safe_value(row['valuenum']),
                'unit': safe_value(row['valueuom'])
            })
    
    # Culture events
    hadm_cultures = culture_df[culture_df['hadm_id'] == hadm_id]
    for _, row in hadm_cultures.iterrows():
        dt = row['charttime'] if pd.notna(row['charttime']) else row['chartdate']
        if pd.notna(dt):
            events.append({
                'datetime': str(dt),
                'type': 'culture',
                'specimen': safe_value(row['spec_type_desc']),
                'organism': safe_value(row['org_name']),
                'isolate_num': safe_value(row['isolate_num']),
                'antibiotic': safe_value(row['ab_name']),
                'interpretation': safe_value(row['interpretation'])
            })
    
    # Medication events (start)
    hadm_meds = meds_df[meds_df['hadm_id'] == hadm_id]
    for _, row in hadm_meds.iterrows():
        if pd.notna(row['starttime']):
            events.append({
                'datetime': str(row['starttime']),
                'type': 'medication_start',
                'name': safe_value(row['medication']),
                'route': safe_value(row['route']),
                'frequency': safe_value(row['frequency']),
                'status': safe_value(row['status'])
            })
        if pd.notna(row['stoptime']):
            events.append({
                'datetime': str(row['stoptime']),
                'type': 'medication_stop',
                'name': safe_value(row['medication']),
                'route': safe_value(row['route']),
                'status': safe_value(row['status'])
            })
    
    # 시간순 정렬
    events.sort(key=lambda x: x['datetime'])
    
    return events

def get_admission_diagnoses(hadm_id):
    """특정 입원의 진단 목록"""
    hadm_dx = diagnosis_df[diagnosis_df['hadm_id'] == hadm_id]
    diagnoses = []
    for _, row in hadm_dx.iterrows():
        diagnoses.append({
            'seq_num': safe_value(row['seq_num']),
            'icd_code': safe_value(row['icd_code']),
            'icd_version': safe_value(row['icd_version']),
            'description': safe_value(row['long_title'])
        })
    return diagnoses

def get_admission_summary(hadm_id):
    """특정 입원의 요약 통계"""
    return {
        'lab_count': len(lab_df[lab_df['hadm_id'] == hadm_id]),
        'vital_count': len(vitals_df[vitals_df['hadm_id'] == hadm_id]),
        'culture_count': len(culture_df[culture_df['hadm_id'] == hadm_id]),
        'medication_count': len(meds_df[meds_df['hadm_id'] == hadm_id]),
        'diagnosis_count': len(diagnosis_df[diagnosis_df['hadm_id'] == hadm_id]),
        'unique_organisms': culture_df[culture_df['hadm_id'] == hadm_id]['org_name'].dropna().unique().tolist()
    }

print("  ✅ 함수 정의 완료")


# ============================================
# Step 4: 환자별 JSON 생성
# ============================================

print("\n[Step 4] 환자별 JSON 생성...")

generated_files = []
error_patients = []

for i, subject_id in enumerate(subject_ids):
    try:
        # 해당 환자의 모든 입원 (시간순 정렬)
        patient_cohort = cohort[cohort['subject_id'] == subject_id].copy()
        patient_cohort = patient_cohort.sort_values('admit_date')
        
        # 환자 기본 정보
        first_record = patient_cohort.iloc[0]
        patient_data = {
            'subject_id': int(subject_id),
            'patient_summary': {
                'total_admissions': len(patient_cohort),
                'cohort_type': first_record['cohort_type'],
                'subcategory': first_record['subcategory'],
                'gender': first_record['gender'],
                'age': safe_value(first_record['age'])
            },
            'admissions': []
        }
        
        # 각 입원별 데이터
        for _, admission in patient_cohort.iterrows():
            hadm_id = int(admission['hadm_id'])
            
            admission_data = {
                'hadm_id': hadm_id,
                'admit_date': str(admission['admit_date']),
                'discharge_date': str(admission['discharge_date']),
                'los_days': round(float(admission['los_days']), 2),
                'infection_types': admission['infection_types'],      # 리스트로 저장
                'infection_timings': admission['infection_timings'],  # 리스트로 저장
                'summary': get_admission_summary(hadm_id),
                'diagnoses': get_admission_diagnoses(hadm_id),
                'timeline': create_timeline_events(hadm_id)
            }
            
            patient_data['admissions'].append(admission_data)
        
        # JSON 저장
        output_path = os.path.join(OUTPUT_DIR, f'patient_{subject_id}.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(patient_data, f, indent=2, ensure_ascii=False, default=str)
        
        generated_files.append(output_path)
        
        # 진행 상황 출력
        if (i + 1) % 10 == 0 or (i + 1) == len(subject_ids):
            print(f"  진행: {i + 1}/{len(subject_ids)} ({(i + 1) / len(subject_ids) * 100:.1f}%)")
    
    except Exception as e:
        error_patients.append({'subject_id': subject_id, 'error': str(e)})
        print(f"  ⚠️ 오류 발생 (subject_id={subject_id}): {e}")

print(f"\n  ✅ JSON 생성 완료: {len(generated_files)}개 파일")
if error_patients:
    print(f"  ⚠️ 오류 발생 환자: {len(error_patients)}명")


# ============================================
# Step 5: 인덱스 파일 생성
# ============================================

print("\n[Step 5] 인덱스 파일 생성...")

index_data = {
    'generated_at': datetime.now().isoformat(),
    'total_patients': len(subject_ids),
    'total_admissions': len(hadm_ids),
    'output_directory': OUTPUT_DIR,
    'patients': []
}

for subject_id in subject_ids:
    patient_cohort = cohort[cohort['subject_id'] == subject_id]
    first_record = patient_cohort.iloc[0]
    
    index_data['patients'].append({
        'subject_id': int(subject_id),
        'cohort_type': first_record['cohort_type'],
        'subcategory': first_record['subcategory'],
        'admission_count': len(patient_cohort),
        'file': f'patient_{subject_id}.json'
    })

index_path = os.path.join(OUTPUT_DIR, '_index.json')
with open(index_path, 'w', encoding='utf-8') as f:
    json.dump(index_data, f, indent=2, ensure_ascii=False)

print(f"  ✅ 인덱스 저장: {index_path}")


# ============================================
# Step 6: 요약 출력
# ============================================

print("\n" + "=" * 70)
print("완료!")
print("=" * 70)

print(f"\n[생성된 파일]")
print(f"  - 환자별 JSON: {len(generated_files)}개")
print(f"  - 인덱스 파일: {index_path}")
print(f"  - 출력 디렉토리: {OUTPUT_DIR}")

print(f"\n[코호트 구성 (원본 기준, 다중 감염 포함)]")
cohort_raw = pd.read_csv(COHORT_CSV)
cohort_summary = cohort_raw.groupby(['cohort_type', 'subcategory']).size()
print(cohort_summary.to_string())

print(f"\n[입원 기준 통계]")
print(f"  - 총 입원 수: {len(cohort)}건 (hadm_id unique)")
print(f"  - 다중 감염 입원: {(cohort['infection_types'].apply(len) > 1).sum()}건")

print(f"\n[데이터 통계]")
print(f"  - 총 Lab 기록: {len(lab_df):,}건")
print(f"  - 총 Vitals 기록: {len(vitals_df):,}건")
print(f"  - 총 Culture 기록: {len(culture_df):,}건")
print(f"  - 총 Medication 기록: {len(meds_df):,}건")
print(f"  - 총 Diagnosis 기록: {len(diagnosis_df):,}건")

# DB 연결 종료
conn.close()
print("\n✅ DuckDB 연결 종료")
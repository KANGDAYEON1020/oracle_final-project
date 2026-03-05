#!/usr/bin/env python3
"""
EMR Generator v2
합성 EMR 데이터 생성기 - 시나리오 기반 순차 생성

Usage:
    python3 main.py <scenario.md>
    python3 main.py patient_scenario/patient_17650289.md
    python3 main.py patient_scenario/patient_17650289.md --model llama3.1:8b
"""
import sys
import argparse
from pathlib import Path

from generator import EMRGenerator, ScenarioParser
import config


def main():
    parser = argparse.ArgumentParser(
        description='EMR Generator v2 - 시나리오 기반 합성 EMR 생성'
    )
    parser.add_argument(
        'scenario',
        type=str,
        help='환자 시나리오 마크다운 파일 경로'
    )
    parser.add_argument(
        '--model',
        type=str,
        default=config.MODEL_NAME,
        help=f'Ollama 모델명 (기본값: {config.MODEL_NAME})'
    )
    parser.add_argument(
        '--output',
        type=str,
        default=str(config.OUTPUT_DIR),
        help=f'출력 디렉토리 (기본값: {config.OUTPUT_DIR})'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='실제 생성 없이 시나리오 파싱만 테스트'
    )

    args = parser.parse_args()

    # 파일 존재 확인
    scenario_path = Path(args.scenario)
    if not scenario_path.exists():
        print(f"오류: 시나리오 파일을 찾을 수 없습니다: {scenario_path}")
        sys.exit(1)

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║              EMR Generator v2                                ║
║              시나리오 기반 합성 EMR 생성                      ║
╚══════════════════════════════════════════════════════════════╝

시나리오: {scenario_path}
모델: {args.model}
출력 경로: {args.output}
""")

    # Dry run 모드
    if args.dry_run:
        print("[ Dry Run 모드 - 시나리오 파싱만 수행 ]\n")
        parser_obj = ScenarioParser(str(scenario_path))
        data = parser_obj.parse()

        print("=== 환자 프로필 ===")
        for k, v in data['profile'].items():
            print(f"  {k}: {v}")

        print("\n=== 핵심 서사 ===")
        print(f"  {data['narrative'][:200]}..." if len(data['narrative']) > 200 else f"  {data['narrative']}")

        print("\n=== Trajectory ===")
        for k, v in data['trajectory'].items():
            print(f"  {k}: {v}")

        print("\n=== 생성 기간 ===")
        period = data.get('generation_period', {})
        print(f"  HD {period.get('start_hd', 1)} ~ HD {period.get('end_hd', 10)}")
        print(f"  D0 기준: HD {period.get('d0_hd', 1)}")

        print("\n=== HD별 이벤트 ===")
        for hd, event_data in data.get('events_by_hd', {}).items():
            if isinstance(event_data, dict):
                label = event_data.get('label', '')
                req_count = len(event_data.get('required_events', []))
                print(f"  HD{hd}: {label} ({req_count}개 이벤트)")
            else:
                print(f"  HD{hd}: {len(event_data)}개 이벤트")

        print("\n파싱 완료. 실제 생성은 --dry-run 없이 실행하세요.")
        return

    # 실제 생성
    try:
        generator = EMRGenerator(
            model_name=args.model,
            output_dir=args.output
        )
        result = generator.generate_for_patient(str(scenario_path))

        print(f"""
╔══════════════════════════════════════════════════════════════╗
║                     생성 완료                                 ║
╚══════════════════════════════════════════════════════════════╝

환자 ID: {result['patient_id']}
생성된 기록: {len(result['records'])}일분
출력 위치: {result['output_dir']}

생성된 파일들:
""")
        output_path = Path(result['output_dir'])
        for f in sorted(output_path.glob("*.md")):
            print(f"  - {f.name}")

    except KeyboardInterrupt:
        print("\n\n사용자에 의해 중단됨")
        sys.exit(1)
    except Exception as e:
        print(f"\n오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

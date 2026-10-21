"""Synchronize only the live battle protocol string; preserve all other JSON bytes."""
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
card_path=root.parent.parent/'【D&D 2024版】.json'
original=card_path.read_bytes().decode('utf-8')
card=json.loads(original)
entry=next(e for e in card['data']['character_book']['entries'] if e['id']==810000)
old=entry['content']
marker='  engine_20261014:'
extension='''
  engine_20261014:
    - 本地引擎版本 2026.10.14-rules.1，网页部署后生效；旧线上版本仍可能不支持以下扩展字段。
    - 2024 正式规则：普通属性检定与普通豁免按总值判定，不因天然20/1自动成败；攻击与死亡豁免保留各自特例。力竭6级死亡，专注受伤豁免DC最高30，临时生命值吸收伤害仍触发专注。
    - 留活口：近战将目标降至0时可改为1HP昏迷并开始短休，不记死亡豁免失败；回复HP或成功DC10医药急救可唤醒。战报显示留活口不等于死亡。
    - 每个生物回合，每名施法者至多消耗一个法术位施法；预备法术登记时已消耗法术位并维持专注，触发不重复扣位。
    - 范围伤害不会自动豁免施法者或倒地生物；按具体能力的排除自身和忽略掩护字段处理例外，不得擅自填true。
    - 敌卡攻击的可选扩展字段：持续轮数（正整数，按受术者回合结束计时）；重复豁免（对象，属性、DC、时机为回合开始或回合结束）；需要看见（布尔）；排除自身（布尔）；忽略掩护（布尔）。仅在原规则明确允许时声明例外；不要根据名称猜测。
    - 专注效果与重复豁免只对已结构化的附加状态自动联动。区域进出触发、全部职业特性、特殊感官、骑乘、水下与完整飞行高度尚非全量支持，需在面板手动裁定；不得描述为已经自动结算。
    - 预备界面目前支持标准动作的单体能力，触发时攻击一次；范围预备与完整反制触发尚需手动裁定。
'''
if marker in old:
    old_base=old[:old.index(marker)].rstrip()
else:
    old_base=old.rstrip()
if old_base.endswith('---'):
    old_base=old_base[:-3].rstrip()
new=old_base+'\n'+extension+'---'
old_token=json.dumps(old,ensure_ascii=False)
new_token=json.dumps(new,ensure_ascii=False)
assert original.count(old_token)==1, 'Protocol token must be unique'
updated=original.replace(old_token,new_token,1)
parsed=json.loads(updated)
expected=json.loads(json.dumps(card,ensure_ascii=False))
next(e for e in expected['data']['character_book']['entries'] if e['id']==810000)['content']=new
assert parsed==expected, 'Only the battle protocol may change'
card_path.write_bytes(updated.encode('utf-8'))
(root.parent/'battle-protocol-worldbook-entry.txt').write_text(new,encoding='utf-8')
(root/'download/battle-forge-st-pack/battle-protocol-worldbook-entry.txt').write_text(new,encoding='utf-8')
print('Updated only character_book entry 810000; bootstrap and all other fields preserved')

'use client';

/**
 * 导入/导出面板：
 * - 粘贴酒馆 DM 消息（<battle>/<battlecheck>/<UpdateVariable>/<dices> 一键解析）
 * - 生成 <battle> 块回贴酒馆
 * - 战报 JSON 导出/导入
 */
import React, { useState } from 'react';
import { useBattleStore } from '@/store/battleStore';
import { generateDicePool } from '@/lib/engine/protocol';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ClipboardPaste, Copy, Download, Upload, FileJson, Dices, Check, ArrowRightLeft, ClipboardList } from 'lucide-react';

const EXAMPLE = `<battle>
艾尔玛|init 18|hp 24/28|pos -5,15|att 0|status poisoned
盗贼|init 15|hp 21/21|pos 0,10|att 0|next
牧师|init 13|hp 30/30|pos 10,5|att 1|status stunned
哥布林甲|init 9|hp 7/7|pos 20,0|att 2
哥布林乙|init 7|hp 5/7|pos 25,5|att 2|status prone
</battle>`;

export function ImportPanel() {
  const store = useBattleStore();
  const [text, setText] = useState('');
  const { toast } = useToast();

  const doImport = () => {
    if (!text.trim()) return;
    const checks = store.importDmMessage(text);
    const added = store.units.length;
    toast({
      title: '导入完成',
      description: `已解析战斗数据${checks.length > 0 ? `与 ${checks.length} 条检定记录` : ''}，当前 ${added} 个单位在场`,
    });
    setText('');
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ClipboardPaste className="h-3.5 w-3.5" />
        粘贴酒馆 DM 消息（自动识别 &lt;battle&gt; / &lt;battlecheck&gt; / &lt;UpdateVariable&gt; / &lt;dices&gt;）
      </div>
      <Textarea
        className="min-h-[130px] border-border/50 bg-black/30 font-mono text-xs"
        placeholder={'支持格式：\n1. 完整 <battle>…</battle> 块\n2. 纯管道行（艾尔玛|init 18|hp 24/28|pos -5,15|att 0）\n3. 整条 DM 回复（自动提取所有协议块）'}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-9 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/85" onClick={doImport}>
          <ArrowRightLeft className="h-4 w-4" />解析导入
        </Button>
        <Button size="sm" variant="secondary" className="h-9 text-xs" onClick={() => setText(EXAMPLE)}>
          填入示例
        </Button>
        <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setText('')}>
          清空
        </Button>
      </div>
      <div className="rounded-lg border border-border/40 bg-black/20 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-primary">字段说明：</span>
        <code className="mx-1">单位ID|init 先攻|hp 当前/上限|pos x,y(英尺)|att 0友1中2敌|status 状态|portrait 立绘|next 当前行动</code>
        导入时引擎字段（AC/属性/抗性等）自动保留，只更新协议字段。同一 UnitId 视为同一单位。
      </div>
    </div>
  );
}

export function ExportPanel() {
  const store = useBattleStore();
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const battleBlock = store.generateExportBlock(true);
  const warReport = store.exportWarReport();
  const battleResult = store.generateBattleResult();

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
      toast({ title: '已复制到剪贴板' });
    } catch {
      toast({ title: '复制失败', description: '请手动选择文本复制', variant: 'destructive' });
    }
  };

  const download = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importReport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = store.importWarReport(String(reader.result));
      toast({
        title: ok ? '战报已导入' : '导入失败',
        description: ok ? '战斗状态已恢复' : '文件格式不正确',
        variant: ok ? 'default' : 'destructive',
      });
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 战报导出（结算权威 = 前端） */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/5 p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200/90">
          <ClipboardList className="h-3.5 w-3.5" />战报 &lt;battleresult&gt;（粘回酒馆 → DM 叙述战后 + 同步变量）
        </div>
        <pre className="log-scroll max-h-44 overflow-auto rounded-lg border border-border/50 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
          {battleResult || '<!-- 场上没有单位 -->'}
        </pre>
        <Button size="sm" className="h-8 gap-1 bg-amber-600/90 text-xs text-white hover:bg-amber-600" onClick={() => copy(battleResult, 'result')}>
          {copied === 'result' ? <Check className="h-3.5 w-3.5 text-green-400" /> : <ClipboardList className="h-3.5 w-3.5" />}
          复制战报给 DM
        </Button>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          战斗中/结束后均可复制：进行中 → DM 只渲染氛围不推进战斗；已结束 → DM 按战报数值叙述战后（伤亡/战利品/经验）并应用建议的变量补丁。数值以前端结算为唯一事实。
        </p>
      </div>

      {/* <battle> 块导出 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Copy className="h-3.5 w-3.5" />生成 &lt;battle&gt; 块（旧协议兼容 / 备份用）
        </div>
        <pre className="log-scroll max-h-40 overflow-auto rounded-lg border border-border/50 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
          {battleBlock || '<!-- 场上没有单位 -->'}
        </pre>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs" onClick={() => copy(battleBlock, 'battle')}>
            {copied === 'battle' ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            复制{' <battle> '}块
          </Button>
          <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs" onClick={() => copy(generateDicePool(), 'dice')}>
            {copied === 'dice' ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Dices className="h-3.5 w-3.5" />}
            复制骰子池模板
          </Button>
        </div>
      </div>

      {/* 战报导出 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileJson className="h-3.5 w-3.5" />战报文件（完整状态 + 日志，可发给队友复盘）
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"
            onClick={() => download(warReport, `dnd-战报-${store.battleName}-${new Date().toISOString().slice(0, 10)}.json`)}>
            <Download className="h-3.5 w-3.5" />导出战报
          </Button>
          <label className={cn('inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border/60 bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80')}>
            <Upload className="h-3.5 w-3.5" />导入战报
            <input type="file" accept=".json" className="hidden"
              onChange={e => e.target.files?.[0] && importReport(e.target.files[0])} />
          </label>
          <Button size="sm" variant="destructive" className="h-8 text-xs"
            onClick={() => { if (confirm('清空当前战斗？此操作不可撤销')) store.reset(); }}>
            清空战场
          </Button>
        </div>
      </div>
    </div>
  );
}

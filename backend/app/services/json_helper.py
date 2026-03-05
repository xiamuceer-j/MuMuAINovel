"""JSON 处理工具类"""
import json
import re
from typing import Any, Dict, List, Union
from app.logger import get_logger

logger = get_logger(__name__)


_THINK_START_TAG = "<think>"
_THINK_END_TAG = "</think>"


class NovelContentFilter:
    """小说正文过滤器：移除思考块与明显元信息（支持流式分块）。"""

    _meta_bracket_pattern = re.compile(r"\[Agent[^\]]*AgentThink[^\]]*\]", re.IGNORECASE)
    _bullet_pattern = re.compile(r"^(?:[-*•]|\d+[\.)]|[一二三四五六七八九十]+[、\.)])\s+")
    _meta_bullet_keyword_pattern = re.compile(
        r"AgentThink|reasoning|analysis|plan\b|step\b"
        r"|(?:思考|推理|分析|步骤|计划)[：:\-—\s]",
        re.IGNORECASE,
    )

    def __init__(self) -> None:
        self._buffer = ""
        self._line_buffer = ""
        self._in_think_block = False
        self.removed_think_chars = 0
        self.removed_meta_lines = 0

    def filter_chunk(self, chunk: str) -> str:
        """过滤一个流式分块，返回可安全展示的正文。"""
        if not chunk:
            return ""

        self._buffer += chunk
        visible = self._extract_visible_content(final=False)
        return self._filter_meta_lines(visible, final=False)

    def flush(self) -> str:
        """在流结束时刷新缓冲区，确保尾部正文不丢失。"""
        visible = self._extract_visible_content(final=True)
        return self._filter_meta_lines(visible, final=True)

    def clean_text(self, text: str) -> str:
        """非流式一次性清洗。"""
        return self.filter_chunk(text) + self.flush()

    def _extract_visible_content(self, final: bool) -> str:
        output_parts: list[str] = []

        while self._buffer:
            if self._in_think_block:
                end_idx = self._buffer.find(_THINK_END_TAG)
                if end_idx == -1:
                    if final:
                        self.removed_think_chars += len(self._buffer)
                        self._buffer = ""
                    else:
                        keep = min(len(self._buffer), len(_THINK_END_TAG) - 1)
                        removed = len(self._buffer) - keep
                        if removed > 0:
                            self.removed_think_chars += removed
                        self._buffer = self._buffer[-keep:] if keep > 0 else ""
                    break

                self.removed_think_chars += end_idx + len(_THINK_END_TAG)
                self._buffer = self._buffer[end_idx + len(_THINK_END_TAG):]
                self._in_think_block = False
                continue

            start_idx = self._buffer.find(_THINK_START_TAG)
            if start_idx == -1:
                if final:
                    output_parts.append(self._buffer)
                    self._buffer = ""
                else:
                    keep = min(len(self._buffer), len(_THINK_START_TAG) - 1)
                    emit_len = len(self._buffer) - keep
                    if emit_len > 0:
                        output_parts.append(self._buffer[:emit_len])
                    self._buffer = self._buffer[-keep:] if keep > 0 else ""
                break

            if start_idx > 0:
                output_parts.append(self._buffer[:start_idx])

            self._buffer = self._buffer[start_idx + len(_THINK_START_TAG):]
            self._in_think_block = True

        return "".join(output_parts)

    def _filter_meta_lines(self, text: str, final: bool) -> str:
        if not text and not (final and self._line_buffer):
            return ""

        combined = self._line_buffer + text
        self._line_buffer = ""
        filtered_parts: list[str] = []

        for line in combined.splitlines(keepends=True):
            is_complete_line = line.endswith("\n") or line.endswith("\r")
            if not is_complete_line and not final:
                self._line_buffer = line
                continue

            if self._should_remove_line(line):
                self.removed_meta_lines += 1
                continue

            filtered_parts.append(line)

        if final and self._line_buffer:
            if not self._should_remove_line(self._line_buffer):
                filtered_parts.append(self._line_buffer)
            else:
                self.removed_meta_lines += 1
            self._line_buffer = ""

        return "".join(filtered_parts)

    def _should_remove_line(self, line: str) -> bool:
        stripped = line.strip()
        if not stripped:
            return False

        if "AgentThink" in stripped:
            return True

        if self._meta_bracket_pattern.search(stripped):
            return True

        if stripped.startswith(_THINK_START_TAG) or stripped.startswith(_THINK_END_TAG):
            return True

        if self._bullet_pattern.match(stripped):
            if len(stripped) <= 80 and self._meta_bullet_keyword_pattern.search(stripped):
                return True

        return False


def clean_novel_content(text: str) -> str:
    """清洗小说正文中的思考标签和明显元信息。"""
    if not text:
        return text

    content_filter = NovelContentFilter()
    return content_filter.clean_text(text)


def _self_check_novel_content_filter() -> None:
    """内部自检（可手动调用）：验证典型边界输入。使用显式异常以兼容 python -O。"""

    def _check(actual: str, expected: str, label: str) -> None:
        if actual != expected:
            raise AssertionError(f"[{label}] expected {expected!r}, got {actual!r}")

    # 1) 单 chunk：<think>...</think> 后正文必须保留
    f1 = NovelContentFilter()
    _check(f1.filter_chunk("<think>先思考</think>正文开始") + f1.flush(), "正文开始", "single-chunk-think")

    # 2) 多 chunk：标签跨分片
    f2 = NovelContentFilter()
    parts2 = ["前文<th", "ink>隐藏", "内容</th", "ink>后文"]
    _check("".join(f2.filter_chunk(part) for part in parts2) + f2.flush(), "前文后文", "cross-chunk-think")

    # 3) 混合元信息：仅移除明显 AgentThink / 规划条目
    f3 = NovelContentFilter()
    text3 = "[Agent x AgentThink]\n- 计划：先分析人物\n真正的叙事段落。"
    _check(f3.clean_text(text3), "真正的叙事段落。", "meta-info-removal")


def clean_json_response(text: str) -> str:
    """清洗 AI 返回的 JSON（改进版 - 流式安全）"""
    try:
        if not text:
            logger.warning("⚠️ clean_json_response: 输入为空")
            return text
        
        original_length = len(text)
        logger.debug(f"🔍 开始清洗JSON，原始长度: {original_length}")
        
        # 去除 markdown 代码块
        text = re.sub(r'^```json\s*\n?', '', text, flags=re.MULTILINE | re.IGNORECASE)
        text = re.sub(r'^```\s*\n?', '', text, flags=re.MULTILINE)
        text = re.sub(r'\n?```\s*$', '', text, flags=re.MULTILINE)
        text = text.strip()
        
        # 移除 <think>...</think> 标签（某些模型会输出思考过程）
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
        
        # 移除有害控制字符（保留 \t \n \r 等合法空白）
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
        text = text.strip()
        
        # 仅记录长度，避免在 info/error 输出敏感文本
        logger.debug(f"📄 清洗后的JSON长度: {len(text)}")
        
        if len(text) != original_length:
            logger.debug(f"   移除markdown后长度: {len(text)}")
        
        # 尝试直接解析（快速路径）
        try:
            json.loads(text)
            logger.debug(f"✅ 直接解析成功，无需清洗")
            return text
        except:
            pass
        
        # 找到第一个 { 或 [
        start = -1
        for i, c in enumerate(text):
            if c in ('{', '['):
                start = i
                break
        
        if start == -1:
            logger.warning(f"⚠️ 未找到JSON起始符号 {{ 或 [")
            logger.debug("   未找到 JSON 起始符号，返回原文本")
            return text
        
        if start > 0:
            logger.debug(f"   跳过前{start}个字符")
            text = text[start:]
        
        # 改进的括号匹配算法（更严格的字符串处理）
        stack = []
        i = 0
        end = -1
        in_string = False
        
        while i < len(text):
            c = text[i]
            
            # 处理字符串状态
            if c == '"':
                if not in_string:
                    # 进入字符串
                    in_string = True
                else:
                    # 检查是否是转义的引号
                    num_backslashes = 0
                    j = i - 1
                    while j >= 0 and text[j] == '\\':
                        num_backslashes += 1
                        j -= 1
                    
                    # 偶数个反斜杠表示引号未被转义，字符串结束
                    if num_backslashes % 2 == 0:
                        in_string = False
                
                i += 1
                continue
            
            # 在字符串内部，跳过所有字符
            if in_string:
                i += 1
                continue
            
            # 处理括号（只有在字符串外部才有效）
            if c == '{' or c == '[':
                stack.append(c)
            elif c == '}':
                if len(stack) > 0 and stack[-1] == '{':
                    stack.pop()
                    if len(stack) == 0:
                        end = i + 1
                        logger.debug(f"✅ 找到JSON结束位置: {end}")
                        break
                elif len(stack) > 0:
                    # 括号不匹配，可能是损坏的JSON，尝试继续
                    logger.warning(f"⚠️ 括号不匹配：遇到 }} 但栈顶是 {stack[-1]}")
                else:
                    # 栈为空遇到 }，忽略多余的闭合括号
                    logger.warning(f"⚠️ 遇到多余的 }}，忽略")
            elif c == ']':
                if len(stack) > 0 and stack[-1] == '[':
                    stack.pop()
                    if len(stack) == 0:
                        end = i + 1
                        logger.debug(f"✅ 找到JSON结束位置: {end}")
                        break
                elif len(stack) > 0:
                    # 括号不匹配，可能是损坏的JSON，尝试继续
                    logger.warning(f"⚠️ 括号不匹配：遇到 ] 但栈顶是 {stack[-1]}")
                else:
                    # 栈为空遇到 ]，忽略多余的闭合括号
                    logger.warning(f"⚠️ 遇到多余的 ]，忽略")
            
            i += 1
        
        # 检查未闭合的字符串
        if in_string:
            logger.warning(f"⚠️ 字符串未闭合，JSON可能不完整")
        
        # 提取结果
        if end > 0:
            result = text[:end]
            logger.debug(f"✅ JSON清洗完成，结果长度: {len(result)}")
        else:
            result = text
            logger.warning(f"⚠️ 未找到JSON结束位置，返回全部内容（长度: {len(result)}）")
            logger.debug(f"   栈状态: {stack}")
        
        # 验证清洗后的结果
        try:
            json.loads(result)
            logger.debug(f"✅ 清洗后JSON验证成功")
        except json.JSONDecodeError as e:
            logger.error(f"❌ 清洗后JSON仍然无效: {e}")
            logger.debug(f"   结果长度: {len(result)}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ clean_json_response 出错: {e}")
        logger.error(f"   文本长度: {len(text) if text else 0}")
        raise


def parse_json(text: str) -> Union[Dict, List]:
    """解析 JSON"""
    try:
        cleaned = clean_json_response(text)
        return json.loads(cleaned)
    except Exception as e:
        logger.error(f"❌ parse_json 出错: {e}")
        logger.error(f"   原始文本长度: {len(text) if text else 0}")
        raise

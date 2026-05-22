"""JSON 处理工具类"""
import json
import re
from typing import Any, Dict, List, Union
from app.logger import get_logger

try:
    import json5
    HAS_JSON5 = True
except ImportError:
    HAS_JSON5 = False

logger = get_logger(__name__)


# 中文引号/括号到ASCII的映射
_QUOTE_MAP = {
    '\u201c': '"',  # " → "
    '\u201d': '"',  # " → "
    '\u2018': "'",  # ' → '
    '\u2019': "'",  # ' → '
    '\u300e': '"',  # 『 → "
    '\u300f': '"',  # 』 → "
    '\u300c': '"',  # 「 → "
    '\u300d': '"',  # 」 → "
}


def _is_content_quote(text: str, pos: int) -> bool:
    """
    判断字符串值内的 '"' 是否为内容引号（需转义）而非 JSON 结束引号。
    
    合法 JSON 中，字符串结束引号之后的非空白字符必须是：
    ',' (值分隔) / '}' (关闭对象) / ']' (关闭数组)
    
    如果 '"' 后面不符合这些模式，则是 AI 写入的内容引号，需要转义。
    """
    j = pos + 1
    
    # 跳过空格和制表符
    while j < len(text) and text[j] in ' \t':
        j += 1
    
    if j >= len(text):
        return False  # 文本末尾，视为结束引号
    
    ch = text[j]
    
    # } 或 ] → 结束引号
    if ch in ('}', ']'):
        return False
    
    # 换行 → 检查下一行开头判断
    if ch == '\n' or ch == '\r':
        k = j + (2 if (ch == '\r' and j + 1 < len(text) and text[j + 1] == '\n') else 1)
        while k < len(text) and text[k] in ' \t':
            k += 1
        if k >= len(text):
            return False
        # 下一行以 " (JSON key) 或 } 或 ] 开头 → 结束引号
        if text[k] == '"' or text[k] in ('}', ']'):
            return False
        return True
    
    # , → 需要检查逗号后面是什么
    if ch == ',':
        k = j + 1
        while k < len(text) and text[k] in ' \t':
            k += 1
        
        if k >= len(text):
            return False
        
        # 逗号后跟换行 → 检查下一行
        if text[k] in ('\n', '\r'):
            k2 = k + (2 if (text[k] == '\r' and k + 1 < len(text) and text[k + 1] == '\n') else 1)
            while k2 < len(text) and text[k2] in ' \t\n\r':
                k2 += 1
            if k2 >= len(text):
                return False
            if text[k2] == '"' or text[k2] in ('}', ']'):
                return False
            return True
        
        after_comma = text[k]
        
        # 结构性逗号后应为 JSON 值的开头
        if after_comma == '"':
            return False  # 字符串值或 key
        if after_comma.isdigit() or after_comma == '-':
            return False  # 数字
        if after_comma in ('{', '['):
            return False  # 对象/数组
        if text[k:k+4] in ('true', 'null'):
            return False
        if text[k:k+5] == 'false':
            return False
        
        # 逗号后不是 JSON 值开头 → 内容逗号，引号是内容引号
        return True
    
    # : → 通常在字符串结束后不可能出现，保守处理为结束引号
    if ch == ':':
        return False
    
    # 其他字符（中文、字母等）→ 内容引号
    return True


def _fix_json_string_values(text: str) -> str:
    """
    上下文感知的 JSON 修复，区分字符串内外分别处理。
    
    字符串值内：
    1. 裸换行符/制表符 → 转义
    2. 中文引号（""等） → 转义为 \\"
    3. 未转义的 ASCII 双引号 → 智能检测：内容引号转义，结束引号保留
    4. 中文逗号/冒号 → 保留原样（是内容字符）
    
    结构位置（字符串外）：
    1. 中文引号 → ASCII 引号
    2. 中文逗号 → ASCII 逗号
    3. 中文冒号 → ASCII 冒号
    """
    if not text or '"' not in text:
        return text
    
    result = []
    i = 0
    in_string = False
    fixed_count = 0
    
    while i < len(text):
        c = text[i]
        
        # === 非字符串内（结构位置）===
        if not in_string:
            # 结构位置的中文标点 → ASCII
            if c == '\uff0c':  # ，→ ,
                result.append(',')
                fixed_count += 1
                i += 1
                continue
            if c == '\uff1a':  # ：→ :
                result.append(':')
                fixed_count += 1
                i += 1
                continue
            if c in _QUOTE_MAP:
                result.append(_QUOTE_MAP[c])
                fixed_count += 1
                i += 1
                continue
            
            # ASCII 双引号 → 进入字符串
            if c == '"':
                in_string = True
                result.append(c)
                i += 1
                continue
            
            result.append(c)
            i += 1
            continue
        
        # === 字符串值内 ===
        
        # 转义字符处理
        if c == '\\':
            if i + 1 < len(text):
                next_c = text[i + 1]
                if next_c in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                    result.append(c)
                    result.append(next_c)
                    i += 2
                    continue
                elif next_c == 'u':
                    if i + 5 < len(text) and all(text[i+2+k] in '0123456789abcdefABCDEF' for k in range(4)):
                        result.append(text[i:i+6])
                        i += 6
                        continue
                    else:
                        result.append(next_c)
                        fixed_count += 1
                        i += 2
                        continue
                else:
                    result.append(next_c)
                    fixed_count += 1
                    i += 2
                    continue
            else:
                fixed_count += 1
                i += 1
                continue
        
        # ASCII 双引号 → 智能判断是结束引号还是内容引号
        if c == '"':
            if _is_content_quote(text, i):
                # 内容引号，需要转义
                result.append('\\')
                result.append('"')
                fixed_count += 1
                i += 1
                continue
            else:
                # 结束引号
                in_string = False
                result.append(c)
                i += 1
                continue
        
        # 裸换行符 → 转义
        if c == '\n':
            result.append('\\')
            result.append('n')
            fixed_count += 1
            i += 1
            continue
        
        if c == '\r':
            if i + 1 < len(text) and text[i + 1] == '\n':
                result.append('\\')
                result.append('n')
                fixed_count += 1
                i += 2
            else:
                result.append('\\')
                result.append('n')
                fixed_count += 1
                i += 1
            continue
        
        if c == '\t':
            result.append('\\')
            result.append('t')
            fixed_count += 1
            i += 1
            continue
        
        # 中文引号处理
        if c in _QUOTE_MAP:
            mapped = _QUOTE_MAP[c]
            if mapped == '"':
                # 中文双引号在字符串内需要转义
                result.append('\\')
                result.append('"')
            else:
                # 中文单引号在双引号字符串内不需要转义，直接替换
                result.append(mapped)
            fixed_count += 1
            i += 1
            continue
        
        # 其他字符（包括中文逗号、中文冒号）→ 保留原样
        result.append(c)
        i += 1
    
    if fixed_count > 0:
        logger.debug(f"✅ 修复了{fixed_count}个JSON问题（引号/控制字符/中文标点）")
    
    return ''.join(result)


def _fix_all_invalid_escapes(text: str) -> str:
    """
    兜底修复：扫描整个文本中的无效JSON转义序列。
    
    当 _fix_json_string_values 因字符串边界追踪错误而遗漏某些无效转义时，
    此函数作为兜底，不依赖字符串状态追踪，扫描整个文本修复所有无效转义。
    
    有效JSON转义：\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX
    其他 \\X 均为无效转义，修复方式为去掉反斜杠只保留字符。
    """
    if '\\' not in text:
        return text
    
    result = []
    i = 0
    fixed = 0
    
    while i < len(text):
        if text[i] == '\\' and i + 1 < len(text):
            next_c = text[i + 1]
            if next_c in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                # 有效转义，保留
                result.append(text[i])
                result.append(next_c)
                i += 2
                continue
            elif next_c == 'u':
                # Unicode 转义，检查是否有4个十六进制字符
                if i + 5 < len(text) and all(
                    text[i + 2 + k] in '0123456789abcdefABCDEF' 
                    for k in range(4)
                ):
                    result.append(text[i:i + 6])
                    i += 6
                    continue
                else:
                    # 不完整的unicode转义，去掉反斜杠
                    result.append(next_c)
                    fixed += 1
                    i += 2
                    continue
            else:
                # 无效转义（如 \引 \影 \某种 等），去掉反斜杠只保留字符
                result.append(next_c)
                fixed += 1
                i += 2
                continue
        else:
            result.append(text[i])
            i += 1
    
    if fixed > 0:
        logger.info(f"✅ 兜底修复了{fixed}个无效JSON转义序列")
    
    return ''.join(result)


def _fix_unescaped_quotes_by_error(text: str, max_fixes: int = 50) -> str:
    """
    基于 json.JSONDecodeError 的错误位置，迭代修复未转义的引号。
    
    当 _fix_json_string_values 的启发式判断失败时（_is_content_quote 误判），
    此函数利用 JSON 解析器提供的精确错误位置来定位问题并修复。
    
    常见场景：AI 在字符串值内写入 "content", "more content" 这样的模式，
    _is_content_quote 可能将其误判为结构引号，导致字符串提前终止。
    
    修复策略：在错误位置前找到最近的未转义引号，将其转义。
    """
    for _ in range(max_fixes):
        try:
            json.loads(text)
            return text  # 解析成功
        except json.JSONDecodeError as e:
            if e.pos is None or e.pos >= len(text):
                break
            
            pos = e.pos
            
            # 从错误位置向前搜索最近的未转义引号
            # 跳过空格和换行
            search_pos = pos - 1
            while search_pos >= 0 and text[search_pos] in ' \t\n\r':
                search_pos -= 1
            
            if search_pos < 0:
                break
            
            # 如果错误位置的字符是引号（Unexpected '"'），直接转义它
            if text[search_pos] == '"':
                # 检查是否已被转义
                num_bs = 0
                k = search_pos - 1
                while k >= 0 and text[k] == '\\':
                    num_bs += 1
                    k -= 1
                if num_bs % 2 == 0:
                    # 未转义的引号，转义它
                    text = text[:search_pos] + '\\"' + text[search_pos + 1:]
                    logger.debug(f"   🔧 在位置 {search_pos} 转义了未转义的引号")
                    continue
            
            # 否则从错误位置向前找引号
            found = False
            for j in range(pos - 1, max(0, pos - 500), -1):
                if text[j] == '"':
                    num_bs = 0
                    k = j - 1
                    while k >= 0 and text[k] == '\\':
                        num_bs += 1
                        k -= 1
                    if num_bs % 2 == 0:
                        text = text[:j] + '\\"' + text[j + 1:]
                        logger.debug(f"   🔧 在位置 {j} 转义了未转义的引号（向前搜索）")
                        found = True
                        break
            if found:
                continue
            
            # 无法修复
            logger.debug(f"   ⚠️ 无法定位可修复的引号，错误位置: {pos}")
            break
    
    return text


def _fix_multiple_objects_as_value(text: str) -> str:
    """
    修复AI生成的JSON中，多个对象作为属性值但未合并的问题。
    
    示例：
        "key": {"a": "1"}, {"b": "2"}  →  "key": {"a": "1", "b": "2"}
    
    AI有时在输出对象类型的属性值时，输出了多个独立的对象而不是合并为一个。
    例如 relationship_changes 字段输出多个角色关系变化时可能出现此问题。
    此函数检测并合并这些对象。
    """
    if '{' not in text or '}' not in text:
        return text
    
    # 匹配嵌套层级不超过2的对象: { ... } 其中 ... 不含 { 或仅含单层嵌套
    nested_obj = r'\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}'
    
    # 模式：属性冒号后跟一个对象，然后逗号和另一个对象（没有属性名）
    # 即 "key": {obj1}, {obj2} → "key": {obj1, obj2}
    pattern = r'(":)\s*(' + nested_obj + r')\s*,\s*(' + nested_obj + r')'
    
    def merge_objects(match):
        colon = match.group(1)
        obj1_content = match.group(2)[1:-1]  # 去掉外层的 { }
        obj2_content = match.group(3)[1:-1]  # 去掉外层的 { }
        # 合并为一个对象
        return f'{colon} {{{obj1_content}, {obj2_content}}}'
    
    prev = None
    count = 0
    max_iterations = 10
    while prev != text and count < max_iterations:
        prev = text
        text = re.sub(pattern, merge_objects, text)
        count += 1
    
    if count > 1:
        logger.info(f"✅ 修复了{count - 1}处多对象属性值合并")
    
    return text


def clean_json_response(text: str) -> str:
    """清洗 AI 返回的 JSON（改进版 - 流式安全）"""
    try:
        if not text:
            logger.warning("⚠️ clean_json_response: 输入为空")
            return text
        
        original_length = len(text)
        logger.debug(f"🔍 开始清洗JSON，原始长度: {original_length}")
        
        # 上下文感知修复：中文引号/逗号/冒号、裸控制字符、未转义的内容引号
        # （区分字符串内外：结构位置替换为ASCII，字符串内保留或转义）
        text = _fix_json_string_values(text)
        
        # 去除 markdown 代码块
        text = re.sub(r'^```json\s*\n?', '', text, flags=re.MULTILINE | re.IGNORECASE)
        text = re.sub(r'^```\s*\n?', '', text, flags=re.MULTILINE)
        text = re.sub(r'\n?```\s*$', '', text, flags=re.MULTILINE)
        text = text.strip()
        
        if len(text) != original_length:
            logger.debug(f"   移除markdown后长度: {len(text)}")
        
        # 尝试直接解析（快速路径）
        try:
            json.loads(text)
            logger.debug(f"✅ 直接解析成功，无需清洗")
            return text
        except Exception:
            pass
        
        # 找到第一个 { 或 [
        start = -1
        for i, c in enumerate(text):
            if c in ('{', '['):
                start = i
                break
        
        if start == -1:
            logger.warning(f"⚠️ 未找到JSON起始符号 {{ 或 [")
            logger.debug(f"   文本预览: {text[:200]}")
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
            logger.warning(f"⚠️ 清洗后JSON仍然无效: {e}，尝试修复结构性问题...")
            
            # 修复1：合并多对象属性值（AI可能输出 "key": {a:1}, {b:2} ）
            result = _fix_multiple_objects_as_value(result)
            
            try:
                json.loads(result)
                logger.info(f"✅ 修复多对象属性值后JSON验证成功")
            except json.JSONDecodeError:
                pass  # 继续尝试其他修复
            else:
                return result
            
            # 修复2：兜底修复无效转义序列（不依赖字符串边界追踪）
            logger.warning(f"⚠️ 继续尝试兜底修复无效转义...")
            result = _fix_all_invalid_escapes(result)
            try:
                json.loads(result)
                logger.info(f"✅ 兜底修复后JSON验证成功")
            except json.JSONDecodeError as e2:
                # 修复3：再次尝试合并多对象属性值（转义修复后可能产生新的合并机会）
                result = _fix_multiple_objects_as_value(result)
                try:
                    json.loads(result)
                    logger.info(f"✅ 二次修复后JSON验证成功")
                except json.JSONDecodeError as e3:
                    # 修复4：基于错误位置迭代修复未转义引号
                    logger.warning(f"⚠️ 继续尝试基于错误位置修复未转义引号...")
                    result = _fix_unescaped_quotes_by_error(result)
                    try:
                        json.loads(result)
                        logger.info(f"✅ 基于错误位置修复后JSON验证成功")
                    except json.JSONDecodeError as e4:
                        logger.error(f"❌ 所有修复后JSON仍然无效: {e4}")
                        logger.debug(f"   结果预览: {result[:500]}")
                        logger.debug(f"   结果结尾: ...{result[-200:]}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ clean_json_response 出错: {e}")
        logger.error(f"   文本长度: {len(text) if text else 0}")
        logger.error(f"   文本预览: {text[:200] if text else 'None'}")
        raise


def parse_json(text: str) -> Union[Dict, List]:
    """解析 JSON，优先使用标准json，失败后用json5容错解析"""
    cleaned = clean_json_response(text)
    
    # 优先使用标准 json
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, Exception):
        pass
    
    # json5 容错解析（处理单引号、多余逗号、宽松格式等）
    if HAS_JSON5:
        try:
            logger.info("🔄 标准JSON解析失败，使用json5容错解析")
            result = json5.loads(cleaned)
            logger.info("✅ json5容错解析成功")
            return result
        except Exception as e5:
            logger.error(f"❌ json5容错解析也失败: {e5}")
    
    # 最终失败
    logger.error(f"❌ parse_json 完全失败")
    logger.error(f"   原始文本长度: {len(text) if text else 0}")
    logger.error(f"   清洗后文本长度: {len(cleaned) if cleaned else 0}")
    logger.debug(f"   清洗后文本预览: {cleaned[:500] if cleaned else 'None'}")
    raise json.JSONDecodeError("JSON解析失败（标准和json5均失败）", cleaned, 0)


def loads_json(text: str) -> Any:
    """
    json.loads 的容错替代品，可直接替换 json.loads()。
    优先用标准 json.loads，失败后自动降级到 json5。
    适用于解析 AI 返回的、可能包含不规范格式的 JSON。
    """
    # 优先使用标准 json
    try:
        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        pass
    
    # 兜底修复无效转义序列后重试
    fixed_text = _fix_all_invalid_escapes(text)
    if fixed_text != text:
        try:
            result = json.loads(fixed_text)
            logger.info("✅ 兜底修复无效转义后json.loads成功")
            return result
        except (json.JSONDecodeError, Exception):
            pass
    
    # json5 容错解析
    if HAS_JSON5:
        try:
            logger.info("🔄 json.loads失败，使用json5容错解析")
            result = json5.loads(text)
            logger.info("✅ json5容错解析成功")
            return result
        except Exception as e5:
            # json5也失败，尝试对修复后的文本使用json5
            if fixed_text != text:
                try:
                    result = json5.loads(fixed_text)
                    logger.info("✅ 兜底修复无效转义后json5容错解析成功")
                    return result
                except Exception:
                    pass
            logger.error(f"❌ json5容错解析也失败: {e5}")
    
    # 最终失败，抛出标准异常
    raise json.JSONDecodeError("JSON解析失败（标准和json5均失败）", text, 0)

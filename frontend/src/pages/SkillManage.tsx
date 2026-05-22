import { useState, useEffect } from 'react';
import { Button, Table, Modal, Form, Input, Tag, Space, message, Popconfirm, Card, theme, Empty, Badge, Select } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, ThunderboltOutlined, FileTextOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface SkillItem {
  template_key: string;
  template_name: string;
  category: string;
  skill_type: string;
  category_hint: string;
  description: string;
  triggers: string[];
}

interface SkillDetail {
  template_key: string;
  template_name: string;
  category: string;
  skill_type: string;
  category_hint: string;
  description: string;
  triggers: string[];
  raw_content: string;
  standalone_references: Record<string, string>;
}

const SKILL_TYPE_OPTIONS = [
  { value: 'writing', label: '✍️ 写作类', hint: '创作章节时注入 → 改变 AI 写作风格（对话、悬念等）' },
  { value: 'polishing', label: '✨ 润色类', hint: '生成两次：先写初稿 → 再自动润色去AI味' },
  { value: 'analysis', label: '🔍 分析类', hint: 'Skill Chat 对话中使用，分析章节内容' },
  { value: 'tool', label: '🔧 工具类', hint: 'Skill Chat 对话中使用，浏览器、搜索等辅助能力' },
  { value: 'generic', label: '💬 通用类', hint: 'Skill Chat 对话中使用，通用助手' },
];

export default function SkillManage() {
  const { token } = theme.useToken();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillDetail | null>(null);
  const [editForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [viewingContent, setViewingContent] = useState('');

  // 加载 Skill 列表
  const loadSkills = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/skills/list');
      if (response.ok) {
        const data = await response.json();
        setSkills(data);
      }
    } catch (error) {
      message.error('加载 Skill 列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  // 打开编辑弹窗
  const handleEdit = async (skill: SkillItem) => {
    try {
      const response = await fetch(`/api/skills/detail/${skill.template_key}`);
      if (response.ok) {
        const detail: SkillDetail = await response.json();
        setEditingSkill(detail);
        editForm.setFieldsValue({
          skill_type: detail.skill_type || 'generic',
          description: detail.description,
          body: detail.raw_content.split('---').slice(2).join('---').trim(),
          references: JSON.stringify(detail.standalone_references, null, 2),
        });
        setEditModalVisible(true);
      } else {
        message.error('获取 Skill 详情失败');
      }
    } catch (error) {
      message.error('获取 Skill 详情失败');
    }
  };

  // 打开查看原始内容弹窗
  const handleViewRaw = async (skill: SkillItem) => {
    try {
      const response = await fetch(`/api/skills/detail/${skill.template_key}`);
      if (response.ok) {
        const detail: SkillDetail = await response.json();
        setViewingContent(detail.raw_content);
        setViewModalVisible(true);
      }
    } catch (error) {
      message.error('获取内容失败');
    }
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingSkill) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      // 解析 references JSON
      let refs: Record<string, string> | undefined;
      if (values.references?.trim()) {
        try {
          refs = JSON.parse(values.references);
        } catch {
          message.error('参考资料 JSON 格式错误');
          setSaving(false);
          return;
        }
      }

      const response = await fetch(`/api/skills/update/${editingSkill.template_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: values.description,
          body: values.body,
          references: refs,
          skill_type: values.skill_type,
        }),
      });

      if (response.ok) {
        message.success('Skill 更新成功');
        setEditModalVisible(false);
        loadSkills();
      } else {
        const err = await response.json();
        message.error(err.detail || '更新失败');
      }
    } catch (error) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 创建新 Skill
  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      let refs: Record<string, string> | undefined;
      if (values.references?.trim()) {
        try {
          refs = JSON.parse(values.references);
        } catch {
          message.error('参考资料 JSON 格式错误');
          setSaving(false);
          return;
        }
      }

      const response = await fetch('/api/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          body: values.body,
          references: refs,
          skill_type: values.skill_type,
        }),
      });

      if (response.ok) {
        message.success('Skill 创建成功');
        setCreateModalVisible(false);
        createForm.resetFields();
        loadSkills();
      } else {
        const err = await response.json();
        message.error(err.detail || '创建失败');
      }
    } catch (error) {
      message.error('创建失败');
    } finally {
      setSaving(false);
    }
  };

  // 删除 Skill
  const handleDelete = async (skillKey: string) => {
    try {
      const response = await fetch(`/api/skills/delete/${skillKey}`, { method: 'DELETE' });
      if (response.ok) {
        message.success('删除成功');
        loadSkills();
      } else {
        const err = await response.json();
        message.error(err.detail || '删除失败');
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'template_name',
      key: 'template_name',
      width: 200,
      ellipsis: true,
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 200,
      render: (cat: string, record: SkillItem) => {
        const colorMap: Record<string, string> = {
          '✍️ 写作类': 'blue',
          '✨ 润色类': 'orange',
          '🔍 分析类': 'green',
          '🔧 工具类': 'purple',
          '💬 通用类': 'default',
          'Skill·写作': 'blue',
          'Skill·润色': 'orange',
          'Skill·分析': 'green',
          'Skill·工具': 'purple',
          'Skill': 'default',
        };
        return (
          <div>
            <Tag color={colorMap[cat] || 'default'}>{cat}</Tag>
            {record.category_hint && (
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                {record.category_hint}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
          {text.length > 80 ? text.substring(0, 80) + '...' : text}
        </span>
      ),
    },
    {
      title: '触发词',
      dataIndex: 'triggers',
      key: 'triggers',
      width: 180,
      render: (triggers: string[]) => (
        <Space wrap size={4}>
          {triggers.slice(0, 3).map((t, i) => (
            <Tag key={i} style={{ fontSize: 11 }}>{t}</Tag>
          ))}
          {triggers.length > 3 && <Tag>+{triggers.length - 3}</Tag>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: SkillItem) => (
        <Space>
          <Button
            type="text"
            icon={<FileTextOutlined />}
            onClick={() => handleViewRaw(record)}
            size="small"
          >
            查看
          </Button>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            size="small"
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此 Skill？"
            description="删除后无法恢复，相关文件将被永久删除。"
            onConfirm={() => handleDelete(record.template_key)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部标题栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            <ThunderboltOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
            Skill 管理
            <Badge count={skills.length} style={{ marginLeft: 8, backgroundColor: token.colorPrimary }} />
          </h2>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
            在线管理 Skill 工作流，添加、编辑或删除
          </div>
        </div>
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadSkills}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              createForm.resetFields();
              setCreateModalVisible(true);
            }}
          >
            添加 Skill
          </Button>
        </Space>
      </div>

      {/* Skill 列表 */}
      {skills.length === 0 && !loading ? (
        <Card>
          <Empty description="暂无 Skill，点击「添加 Skill」创建">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
              添加 Skill
            </Button>
          </Empty>
        </Card>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Table
            dataSource={skills}
            columns={columns}
            rowKey="template_key"
            loading={loading}
            pagination={false}
            size="middle"
            style={{ background: token.colorBgContainer }}
          />
        </div>
      )}

      {/* 查看原始内容弹窗 */}
      <Modal
        title="SKILL.md 原始内容"
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        width={800}
        footer={<Button onClick={() => setViewModalVisible(false)}>关闭</Button>}
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      >
        <pre style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13,
          lineHeight: 1.6,
          background: token.colorFillQuaternary,
          padding: 16,
          borderRadius: 8,
        }}>
          {viewingContent}
        </pre>
      </Modal>

      {/* 编辑 Skill 弹窗 */}
      <Modal
        title="编辑 Skill"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        width={900}
        footer={
          <Space>
            <Button onClick={() => setEditModalVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleSaveEdit} loading={saving}>保存</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="分类" name="skill_type" rules={[{ required: true, message: '请选择分类' }]}
            tooltip="决定 Skill 的生效时机和执行方式">
            <Select placeholder="选择 Skill 分类">
              {SKILL_TYPE_OPTIONS.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>
                  <div>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#999' }}>{opt.hint}</div>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="描述" name="description" rules={[{ required: true, message: '请输入描述' }]}
            tooltip="第一句话会作为 UI 显示名称">
            <TextArea rows={3} placeholder="一句话描述 Skill 功能。后续详细说明..." />
          </Form.Item>
          <Form.Item label="工作流指令" name="body" rules={[{ required: true, message: '请输入工作流指令' }]}
            tooltip="SKILL.md 中 YAML frontmatter 之后的 Markdown 正文">
            <TextArea rows={15} placeholder="输入 Skill 的完整工作流指令..." style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </Form.Item>
          <Form.Item label="参考资料 (JSON)" name="references"
            tooltip='格式：{"文件名": "内容"}。留空则保留原有参考资料'>
            <TextArea rows={8} placeholder='{"anti-ai-tips": "去AI味的技巧...", "quality-check": "质量检查清单..."}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建 Skill 弹窗 */}
      <Modal
        title="添加新 Skill"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        width={900}
        footer={
          <Space>
            <Button onClick={() => setCreateModalVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleCreate} loading={saving}>创建</Button>
          </Space>
        }
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="Skill 名称（英文）" name="name" rules={[{ required: true, message: '请输入名称' }]}
            tooltip="英文小写+短横线，如 my-new-skill。将作为目录名和内部标识">
            <Input placeholder="my-new-skill" />
          </Form.Item>
          <Form.Item label="分类" name="skill_type" rules={[{ required: true, message: '请选择分类' }]}
            tooltip="决定 Skill 的生效时机和执行方式">
            <Select placeholder="选择 Skill 分类">
              {SKILL_TYPE_OPTIONS.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>
                  <div>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: 11, color: '#999' }}>{opt.hint}</div>
                  </div>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="描述" name="description" rules={[{ required: true, message: '请输入描述' }]}
            tooltip="第一句话会作为 UI 显示名称">
            <TextArea rows={3} placeholder="一句话描述 Skill 功能。后续详细说明..." />
          </Form.Item>
          <Form.Item label="工作流指令" name="body" rules={[{ required: true, message: '请输入工作流指令' }]}
            tooltip="Skill 的核心 Markdown 内容">
            <TextArea rows={15} placeholder={"# my-new-skill：Skill 标题\n\n你是 xxx 专家。你的任务是帮用户完成 xxx。\n\n## 核心原则\n\n- 原则1...\n\n## 工作流程\n\n### Phase 1：需求确认\n..."} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </Form.Item>
          <Form.Item label="参考资料 (JSON，可选)" name="references"
            tooltip='格式：{"文件名": "内容"}'>
            <TextArea rows={8} placeholder='{"tips": "参考技巧...", "examples": "示例..."}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '../../src/store/AppContext';
import { Priority, Task } from '../../src/types';
import {
  colors,
  priorityColor,
  priorityLabel,
  radius,
  spacing,
} from '../../src/theme';
import { Chip, EmptyState, ScreenTitle } from '../../src/components/ui';

type Filter = 'active' | 'completed' | 'all';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const { tasks, addTask, toggleTask, deleteTask, startTimer } = useApp();

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [filter, setFilter] = useState<Filter>('active');

  const visibleTasks = useMemo(() => {
    const byFilter = tasks.filter((t) => {
      if (filter === 'active') return !t.completed;
      if (filter === 'completed') return t.completed;
      return true;
    });
    const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
    return [...byFilter].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (order[a.priority] !== order[b.priority])
        return order[a.priority] - order[b.priority];
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [tasks, filter]);

  const activeCount = tasks.filter((t) => !t.completed).length;

  const handleAdd = () => {
    if (!title.trim()) return;
    addTask({ title, priority });
    setTitle('');
    setPriority('medium');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <ScreenTitle
          title="Tasks"
          subtitle={
            activeCount > 0
              ? `${activeCount} task${activeCount === 1 ? '' : 's'} to do`
              : 'All caught up'
          }
        />

        <View style={styles.composer}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Add a task…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <Pressable
            onPress={handleAdd}
            style={({ pressed }) => [
              styles.addButton,
              { opacity: title.trim() ? (pressed ? 0.8 : 1) : 0.4 },
            ]}
          >
            <Ionicons name="add" size={26} color="#0F1115" />
          </Pressable>
        </View>

        <View style={styles.chipRow}>
          {PRIORITIES.map((p) => (
            <Chip
              key={p}
              label={priorityLabel[p]}
              active={priority === p}
              color={priorityColor[p]}
              onPress={() => setPriority(p)}
            />
          ))}
        </View>

        <View style={styles.filterRow}>
          {(['active', 'completed', 'all'] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)}>
              <Text
                style={[
                  styles.filterText,
                  filter === f && styles.filterTextActive,
                ]}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={visibleTasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              onToggle={() => toggleTask(item.id)}
              onDelete={() => deleteTask(item.id)}
              onFocus={() => {
                startTimer({ taskId: item.id, label: item.title, source: 'timer' });
                router.push('/focus');
              }}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-outline"
              title={filter === 'completed' ? 'Nothing completed yet' : 'No tasks'}
              message={
                filter === 'completed'
                  ? 'Finished tasks will show up here.'
                  : 'Add your first task above to get started.'
              }
            />
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onFocus,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onFocus: () => void;
}) {
  return (
    <View style={styles.taskRow}>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.checkbox}>
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={task.completed ? colors.success : colors.textFaint}
        />
      </Pressable>

      <View style={styles.taskBody}>
        <Text
          style={[styles.taskTitle, task.completed && styles.taskTitleDone]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          <View
            style={[
              styles.priorityDot,
              { backgroundColor: priorityColor[task.priority] },
            ]}
          />
          <Text style={styles.taskMetaText}>{priorityLabel[task.priority]}</Text>
        </View>
      </View>

      {!task.completed && (
        <Pressable onPress={onFocus} hitSlop={8} style={styles.iconButton}>
          <Ionicons name="play-circle-outline" size={24} color={colors.primary} />
        </Pressable>
      )}
      <Pressable onPress={onDelete} hitSlop={8} style={styles.iconButton}>
        <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: colors.primary,
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filterText: {
    color: colors.textFaint,
    fontSize: 15,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.text,
    textDecorationLine: 'underline',
    textDecorationColor: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  checkbox: { paddingRight: spacing.xs },
  taskBody: { flex: 1 },
  taskTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  taskTitleDone: {
    color: colors.textFaint,
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  taskMetaText: { color: colors.textMuted, fontSize: 13 },
  iconButton: { padding: spacing.xs },
});

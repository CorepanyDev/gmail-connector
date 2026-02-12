import { Router } from 'express';
import { getTasksService } from '../../tasks';

export function createTaskRoutes(): Router {
  const router = Router();

  // List task lists
  router.get('/lists', async (_req, res, next) => {
    try {
      const tasks = getTasksService();
      const lists = await tasks.getTaskLists();
      res.json({ taskLists: lists });
    } catch (err) {
      next(err);
    }
  });

  // List tasks in a list
  router.get('/lists/:listId/tasks', async (req, res, next) => {
    try {
      const tasks = getTasksService();
      const items = await tasks.getTasks(req.params.listId, {
        showCompleted: req.query.showCompleted === 'true',
        dueMax: req.query.dueBefore as string | undefined,
      });
      res.json({ tasks: items });
    } catch (err) {
      next(err);
    }
  });

  // Create task
  router.post('/lists/:listId/tasks', async (req, res, next) => {
    try {
      const { title, notes, due } = req.body;
      if (!title || typeof title !== 'string') {
        res.status(400).json({
          error: { code: 'bad_request', message: 'title is required', status: 400 },
        });
        return;
      }

      const tasks = getTasksService();
      const task = await tasks.createTask(req.params.listId, title, { notes, due });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  });

  // Update task
  router.patch('/lists/:listId/tasks/:taskId', async (req, res, next) => {
    try {
      const tasks = getTasksService();
      const task = await tasks.updateTask(
        req.params.listId,
        req.params.taskId,
        req.body
      );
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  // Complete task
  router.post('/lists/:listId/tasks/:taskId/complete', async (req, res, next) => {
    try {
      const tasks = getTasksService();
      const task = await tasks.completeTask(req.params.listId, req.params.taskId);
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  // Delete task
  router.delete('/lists/:listId/tasks/:taskId', async (req, res, next) => {
    try {
      const tasks = getTasksService();
      await tasks.deleteTask(req.params.listId, req.params.taskId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

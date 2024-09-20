import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
// import { instanceToPlain } from 'class-transformer';
import { ObjectId, Repository } from 'typeorm';

import { IGroupService } from '../interfaces/group';
import { Services } from '@/constants/constants';
import { Group, GroupMessage } from '@/utils/typeorm';
import {
  CreateGroupMessageParams,
  DeleteGroupMessageParams,
  EditGroupMessageParams,
} from '@/utils/types';
import { IGroupMessageService } from '../interfaces/group-messages';
import { UsersService } from '@/modules/users/users.service';
// import { IMessageAttachmentsService } from '../../message-attachments/message-attachments';

@Injectable()
export class GroupMessageService implements IGroupMessageService {
  constructor(
    @InjectRepository(GroupMessage)
    private readonly groupMessageRepository: Repository<GroupMessage>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @Inject(Services.GROUPS)
    private readonly groupService: IGroupService,
    // @Inject(Services.MESSAGE_ATTACHMENTS)
    // private readonly messageAttachmentsService: IMessageAttachmentsService,
    private readonly userService: UsersService,
  ) {}

  async createGroupMessage({
    groupId: id,
    ...params
  }: CreateGroupMessageParams) {
    const { content, author } = params;
    const group = await this.groupService.findGroupById(id);
    if (!group)
      throw new HttpException('No Group Found', HttpStatus.BAD_REQUEST);

    const findUser = group.users.find(
      (u) => u._id.toString() === author._id.toString(),
    );
    if (!findUser)
      throw new HttpException('User not in group', HttpStatus.BAD_REQUEST);
    const groupMessage = this.groupMessageRepository.create({
      content,
      // group,
      group_id: group._id.toString(),
      // author: instanceToPlain(author),
      author_id: author._id.toString(),
      // attachments: params.attachments
      //   ? await this.messageAttachmentsService.createGroupAttachments(
      //       params.attachments,
      //     )
      //   : [],
    });
    const savedMessage = await this.groupMessageRepository.save(groupMessage);
    group.lastMessageSent = savedMessage;
    const updatedGroup = await this.groupService.saveGroup(group);
    return { message: savedMessage, group: updatedGroup };
  }

  async getGroupMessages(id: string): Promise<GroupMessage[]> {
    const groupMessage = await this.groupMessageRepository.find({
      where: { group_id: id },
      order: {
        created_at: 'DESC',
      },
    });

    // relations: ['author', 'attachments', 'author.profile'],
    if (groupMessage.length > 0) {
      await Promise.all(
        groupMessage.map(async (group) => {
          // relation: author
          const authorFound = await this.userService.findById(group.author_id);
          group.author = authorFound || null;

          // relation: attachment
          // const attachmentFound = await this.messageAttachmentsService.findById(
          //   message.attachments_id,
          // );
          // message.attachments = authorFound || null;
        }),
      );
    }

    return groupMessage;
  }

  async deleteGroupMessage(params: DeleteGroupMessageParams) {
    console.log(params);
    const group = await this.groupRepository
      .createQueryBuilder('group')
      .where('group.id = :groupId', { groupId: params.groupId })
      .leftJoinAndSelect('group.lastMessageSent', 'lastMessageSent')
      .leftJoinAndSelect('group.messages', 'messages')
      .orderBy('messages.createdAt', 'DESC')
      .limit(5)
      .getOne();

    if (!group)
      throw new HttpException('Group not found', HttpStatus.BAD_REQUEST);
    const message = await this.groupMessageRepository.findOne({
      where: {
        _id: new ObjectId(params.messageId),
        author_id: params.userId,
        group_id: params.groupId,
      },
    });

    if (!message)
      throw new HttpException('Cannot delete message', HttpStatus.BAD_REQUEST);

    if (group.lastMessageSent_id !== message._id.toString())
      return this.groupMessageRepository.delete(message._id.toString());

    const size = group.messages.length;
    const SECOND_MESSAGE_INDEX = 1;
    if (size <= 1) {
      console.log('Last Message Sent is deleted');
      await this.groupRepository.update(params.groupId, {
        lastMessageSent: null,
      });
      return this.groupMessageRepository.delete(message._id.toString());
    } else {
      console.log('There are more than 1 message');
      const newLastMessage = group.messages[SECOND_MESSAGE_INDEX];
      await this.groupRepository.update(params.groupId, {
        lastMessageSent: newLastMessage,
      });
      return this.groupMessageRepository.delete(message._id.toString());
    }
  }

  async editGroupMessage(params: EditGroupMessageParams) {
    const messageDB = await this.groupMessageRepository.findOne({
      where: {
        _id: new ObjectId(params.messageId),
        author_id: params.userId,
      },
      relations: ['group', 'group.creator', 'group.users', 'author'],
    });
    if (!messageDB)
      throw new HttpException('Cannot Edit Message', HttpStatus.BAD_REQUEST);
    messageDB.content = params.content;
    return this.groupMessageRepository.save(messageDB);
  }
}

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const InviteCodeDevice = sequelize.define('InviteCodeDevice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  inviteCodeId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deviceFingerprint: {
    type: DataTypes.STRING(191),
    allowNull: false
  },
  deviceName: {
    type: DataTypes.STRING(191),
    allowNull: true,
    defaultValue: null
  },
  platform: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: 'desktop'
  },
  boundAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  tableName: 'invite_code_devices',
  timestamps: false,
  underscored: true
});

module.exports = InviteCodeDevice;

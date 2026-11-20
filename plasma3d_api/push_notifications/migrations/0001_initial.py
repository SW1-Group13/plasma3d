from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='DeviceToken',
            fields=[
                (
                    'id',
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name='ID',
                    ),
                ),
                ('user_id', models.PositiveIntegerField(db_index=True)),
                ('token', models.CharField(max_length=512, unique=True)),
                (
                    'platform',
                    models.CharField(
                        choices=[('android', 'Android'), ('ios', 'iOS')],
                        max_length=10,
                    ),
                ),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]

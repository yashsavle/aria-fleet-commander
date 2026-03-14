import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, ExecuteProcess
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory

def generate_launch_description():
    tb3_gazebo = get_package_share_directory('turtlebot3_gazebo')
    return LaunchDescription([
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(tb3_gazebo,'launch','turtlebot3_world.launch.py')
            )
        ),
        Node(package='aria_fleet', executable='fleet_manager',
             name='aria_fleet_manager', output='screen'),
        Node(package='rosbridge_server', executable='rosbridge_websocket',
             name='rosbridge', output='screen',
             parameters=[{'port': 9090}]),
    ])
